"use client";

/**
 * File d'upload multi-fichiers de /transcriptions.
 *
 * L'état vit dans un store de MODULE (zustand, comme Toast) et non dans le
 * composant : ouvrir le détail d'une transcription pendant qu'un lot de 50
 * vidéos s'uploade démonte la page, et la file doit continuer — progression
 * comprise — quand on y revient. Le store n'est modifié que par des actions
 * navigateur (jamais pendant le rendu serveur).
 *
 * - 3 fichiers en parallèle : pour un lot de 50 vidéos, la liste se remplit tout
 *   de suite et chaque ligne suit son upload.
 * - Prepare au moment de l'upload (POST /api/transcription) : l'URL pré-signée
 *   d'un PUT unique n'est valable qu'une heure, elle ne doit pas être signée
 *   pour un fichier qui attendra son tour plus longtemps. Les réglages du lot
 *   (intervenants, langues) sont lus à ce moment-là.
 * - PUT unique avec progression (≤ 100 Mo) ou multipart, puis /upload-complete
 *   qui confirme l'upload côté serveur (`uploadedAt`). Heartbeat cadencé par une
 *   horloge, pas seulement par la progression (une part de 128 Mo peut prendre
 *   plus de 10 min sur un lien lent).
 * - Annulation et réessai par fichier ; un upload échoué ou annulé supprime son
 *   job côté serveur (DELETE) pour ne pas laisser de ligne fantôme.
 */

import { create } from "zustand";
import { createUploadHeartbeat, uploadFileInParts } from "@/lib/upload/multipartClient";
import { UPLOAD_LIMITS, tooLargeMessage } from "@/lib/upload/limits";
import { newBatchId } from "@/lib/transcription/batches";
import { isUploadActive, type TranscriptionUpload, type UploadPhase } from "./workspaceModel";

/** Fichiers uploadés simultanément. */
const FILE_CONCURRENCY = 3;

/** Cadence du heartbeat pendant un upload (le client le limite à un appel / 2 min). */
const HEARTBEAT_TICK_MS = 30_000;

/** Un upload terminé quitte la file une fois le job serveur rafraîchi. */
const DONE_RETENTION_MS = 60_000;

/**
 * Réessais automatiques d'une étape sur erreur transitoire (coupure réseau,
 * 5xx, 429) : une coupure Wi-Fi d'une minute ne doit pas faire échouer un lot
 * de 50 vidéos fichier par fichier.
 */
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000];

/**
 * Parties d'un gros fichier : délais plus longs (≈ 2 min cumulées). Une partie
 * en échec ferait repartir tout le fichier de zéro.
 */
const PART_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000];

export const TRANSCRIPTION_EXTENSIONS = ["mp3", "wav", "m4a", "flac", "ogg", "aac", "mp4", "mov", "mkv", "webm"];
export const TRANSCRIPTION_ACCEPT = TRANSCRIPTION_EXTENSIONS.map((ext) => `.${ext}`).join(",");

export type UploadSettings = {
  /** 1 langue = mono ; 2+ = multi-langue. */
  languages: string[];
  enableDiarization: boolean;
};

/** Événements serveur émis par la file, écoutés par la page pour se rafraîchir. */
export type UploadServerEvent =
  | { type: "changed" }
  /** Job supprimé côté serveur (upload échoué ou annulé avant confirmation). */
  | { type: "removed"; jobId: string };

type PrepareResponse = {
  code?: string;
  jobId?: string;
  uploadUrl?: string;
  /** Content-Type signé dans l'URL pré-signée : à renvoyer tel quel. */
  contentType?: string;
  multipart?: { uploadId: string; partSize: number; partUrls: { partNumber: number; url: string }[] };
  error?: string;
};

type StoreState = {
  uploads: TranscriptionUpload[];
  /** Réglages par lot, lus au prepare de chaque fichier du lot. */
  batchSettings: Record<string, UploadSettings>;
};

const useUploadStore = create<StoreState>()(() => ({ uploads: [], batchSettings: {} }));

// ─── État de module (hors rendu) ────────────────────────────────────────────

const files = new Map<string, File>();
const slotIds = new Map<string, string | null>();
/** Compte qui a déposé chaque fichier (le serveur refuse si le compte actif a changé). */
const ownerIds = new Map<string, string>();
const controllers = new Map<string, AbortController>();
const reportedProgress = new Map<string, number>();
const queue: string[] = [];
const listeners = new Set<(event: UploadServerEvent) => void>();
/** Jobs créés depuis cet onglet : seuls eux déclenchent le retour à la publication. */
const sessionJobIds = new Set<string>();
let active = 0;
let order = 0;

function emit(event: UploadServerEvent) {
  for (const listener of listeners) listener(event);
}

function update(key: string, patch: Partial<TranscriptionUpload>) {
  useUploadStore.setState((state) => ({
    uploads: state.uploads.map((upload) => (upload.key === key ? { ...upload, ...patch } : upload)),
  }));
}

function remove(key: string) {
  files.delete(key);
  slotIds.delete(key);
  ownerIds.delete(key);
  reportedProgress.delete(key);
  useUploadStore.setState((state) => ({ uploads: state.uploads.filter((upload) => upload.key !== key) }));
}

/** Progression throttlée : un rendu par point de pourcentage, pas par événement XHR. */
function reportProgress(key: string, fraction: number) {
  const rounded = Math.min(1, Math.floor(fraction * 100) / 100);
  if (reportedProgress.get(key) === rounded) return;
  reportedProgress.set(key, rounded);
  update(key, { progress: rounded });
}

function fileExtension(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function abortError(): DOMException {
  return new DOMException("Upload annulé", "AbortError");
}

/** Réponse HTTP en erreur : le statut décide si un réessai a un sens. */
class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

function isTransient(error: unknown, retryNetwork: boolean): boolean {
  if (isAbort(error)) return false;
  if (error instanceof HttpError) return error.status >= 500 || error.status === 429 || error.status === 408;
  return retryNetwork; // TypeError « Failed to fetch », erreur réseau XHR
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(abortError());
      },
      { once: true },
    );
  });
}

/**
 * Exécute une étape avec réessais. `retryNetwork: false` pour une étape non
 * idempotente (le prepare crée un job : une requête arrivée au serveur dont la
 * réponse s'est perdue créerait un doublon).
 */
async function withRetry<T>(
  signal: AbortSignal,
  step: () => Promise<T>,
  opts: { retryNetwork: boolean } = { retryNetwork: true },
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await step();
    } catch (error) {
      if (attempt >= RETRY_DELAYS_MS.length || signal.aborted || !isTransient(error, opts.retryNetwork)) throw error;
      await sleep(RETRY_DELAYS_MS[attempt], signal);
    }
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string };
    if (data.error) return data.error;
  } catch {
    // Corps non JSON.
  }
  return `Erreur ${response.status}`;
}

/** PUT avec progression ; vers R2 (URL pré-signée) ou /upload-local en dev. */
function putWithProgress(
  file: File,
  url: string,
  contentType: string,
  signal: AbortSignal,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new HttpError(`Envoi échoué (${xhr.status})`, xhr.status));
    };
    xhr.onerror = () => reject(new Error("Erreur réseau pendant l'envoi"));
    xhr.onabort = () => reject(abortError());
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

/** POST /upload-complete (idempotent côté serveur). */
async function confirmUpload(jobId: string, body: string, signal: AbortSignal): Promise<void> {
  const res = await fetch(`/api/transcription/${jobId}/upload-complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal,
  });
  if (!res.ok) throw new HttpError(await readError(res), res.status);
}

function settingsFor(batchId: string): UploadSettings {
  return useUploadStore.getState().batchSettings[batchId] ?? { languages: ["fr"], enableDiarization: false };
}

/** Supprime côté serveur le job d'un upload échoué ou annulé. */
async function discardJob(jobId: string, multipartUploadId: string | null) {
  if (multipartUploadId) {
    void fetch(`/api/transcription/${jobId}/upload-abort`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadId: multipartUploadId }),
    }).catch(() => undefined);
  }
  try {
    // Réessayé : l'échec d'envoi vient souvent d'une coupure réseau, et un job
    // non supprimé resterait « Envoi incomplet » à côté de la ligne en échec.
    const data = await withRetry(new AbortController().signal, async () => {
      const res = await fetch(`/api/transcription/${jobId}`, { method: "DELETE" });
      if (res.status === 404) return { deleted: true }; // déjà supprimé
      if (!res.ok && res.status !== 409) throw new HttpError(await readError(res), res.status);
      return (await res.json().catch(() => ({}))) as { deleted?: boolean };
    });
    emit(data.deleted ? { type: "removed", jobId } : { type: "changed" });
  } catch {
    emit({ type: "changed" });
  }
}

async function runUpload(key: string) {
  const file = files.get(key);
  const upload = useUploadStore.getState().uploads.find((candidate) => candidate.key === key);
  if (!file || !upload) return;

  const controller = new AbortController();
  controllers.set(key, controller);
  reportedProgress.delete(key);
  let jobId: string | null = null;
  let multipartUploadId: string | null = null;
  let heartbeatTimer: number | null = null;

  try {
    update(key, { phase: "preparing", progress: 0, error: null, jobId: null });
    const settings = settingsFor(upload.batchId);
    const slotId = slotIds.get(key) ?? null;

    // Pas de signal ici : un prepare interrompu en vol créerait le job sans
    // qu'on connaisse son id. On le laisse aboutir, puis on supprime le job.
    const prepared = await withRetry(
      controller.signal,
      async () => {
        const prepareRes = await fetch("/api/transcription", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            ext: fileExtension(file.name),
            size: file.size,
            model: "turbo",
            ...(settings.languages.length >= 2
              ? { languages: settings.languages }
              : { language: settings.languages[0] ?? "fr" }),
            enable_diarization: settings.enableDiarization,
            batchId: upload.batchId,
            ...(slotId ? { slotId } : {}),
            ...(ownerIds.has(key) ? { ownerId: ownerIds.get(key) } : {}),
          }),
        });
        const body = (await prepareRes.json().catch(() => ({}))) as PrepareResponse;
        if (!prepareRes.ok) {
          throw new HttpError(body.error ?? `Erreur ${prepareRes.status}`, prepareRes.status, body.code);
        }
        return body;
      },
      { retryNetwork: false },
    );
    if (!prepared.jobId || (!prepared.uploadUrl && !prepared.multipart)) {
      throw new Error("Le serveur n'a pas renvoyé d'adresse d'upload.");
    }
    jobId = prepared.jobId;
    sessionJobIds.add(jobId);
    update(key, { jobId, phase: "uploading" });
    emit({ type: "changed" });
    if (controller.signal.aborted) throw abortError();

    // Réglage du lot modifié pendant le prepare : on aligne ce job.
    const latest = settingsFor(upload.batchId);
    if (latest.enableDiarization !== settings.enableDiarization) {
      void fetch(`/api/transcription/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enable_diarization: latest.enableDiarization }),
      }).catch(() => undefined);
    }

    // Signe de vie tant que l'upload dure : sans lui, le sweep admin tiendrait
    // le job pour abandonné au bout de 10 min sans écriture en base.
    const heartbeat = createUploadHeartbeat(`/api/transcription/${jobId}/upload-heartbeat`, controller.signal);
    heartbeatTimer = window.setInterval(heartbeat, HEARTBEAT_TICK_MS);

    if (prepared.multipart) {
      const { uploadId, partSize, partUrls } = prepared.multipart;
      multipartUploadId = uploadId;
      const parts = await uploadFileInParts(file, partUrls, partSize, {
        signal: controller.signal,
        retryDelaysMs: PART_RETRY_DELAYS_MS,
        onProgress: (fraction) => {
          heartbeat();
          reportProgress(key, fraction);
        },
      });
      update(key, { phase: "finalizing" });
      await withRetry(controller.signal, () =>
        confirmUpload(jobId!, JSON.stringify({ uploadId, parts }), controller.signal),
      );
      multipartUploadId = null;
    } else {
      const uploadUrl = prepared.uploadUrl!;
      // Type dérivé de l'extension par le serveur (stocké avec l'objet R2), à
      // défaut celui du navigateur.
      const contentType = prepared.contentType ?? (file.type || "application/octet-stream");
      // PUT idempotent (même URL, même clé) : réessayable.
      await withRetry(controller.signal, () =>
        putWithProgress(file, uploadUrl, contentType, controller.signal, (fraction) => reportProgress(key, fraction)),
      );
      // En dev, /upload-local confirme lui-même l'upload. Vers R2, on fait
      // vérifier l'arrivée du fichier par le serveur.
      if (!uploadUrl.startsWith("/")) {
        update(key, { phase: "finalizing" });
        await withRetry(controller.signal, () => confirmUpload(jobId!, "{}", controller.signal));
      }
    }

    update(key, { phase: "done", progress: 1 });
    files.delete(key);
    emit({ type: "changed" });
    window.setTimeout(() => remove(key), DONE_RETENTION_MS);
  } catch (error) {
    const cancelled = controller.signal.aborted || isAbort(error);
    // Arrête les envois encore en vol (autres parties d'un multipart).
    controller.abort();
    if (jobId) void discardJob(jobId, multipartUploadId);
    if (cancelled) {
      remove(key);
    } else {
      // jobId conservé : si la suppression du job échoue (hors ligne), la ligne
      // en échec et le job ne font qu'une ligne au lieu de deux.
      update(key, { phase: "error", error: errorMessage(error) });
      if (error instanceof HttpError && error.code === "OWNER_CHANGED") failQueuedOf(ownerIds.get(key), errorMessage(error));
    }
  } finally {
    if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
    controllers.delete(key);
  }
}

/** Compte actif changé : les fichiers encore en file de ce compte ne partiront pas. */
function failQueuedOf(ownerId: string | undefined, message: string) {
  if (!ownerId) return;
  for (const key of [...queue]) {
    if (ownerIds.get(key) !== ownerId) continue;
    queue.splice(queue.indexOf(key), 1);
    update(key, { phase: "error", error: message });
  }
}

function pump() {
  while (active < FILE_CONCURRENCY && queue.length > 0) {
    const key = queue.shift()!;
    active += 1;
    void runUpload(key).finally(() => {
      active -= 1;
      pump();
    });
  }
}

// ─── Actions ────────────────────────────────────────────────────────────────

/**
 * Ajoute des fichiers à un lot. Les fichiers refusés (format, taille) ne sont
 * pas mis en file ; leur nom et la raison sont renvoyés pour un toast.
 */
export function enqueueUploads(
  list: File[],
  batchId: string,
  slotId: string | null,
  ownerId: string,
): { accepted: number; rejected: string[] } {
  const rejected: string[] = [];
  const droppedAt = new Date().toISOString();
  const added: TranscriptionUpload[] = [];

  for (const file of list) {
    if (!TRANSCRIPTION_EXTENSIONS.includes(fileExtension(file.name))) {
      rejected.push(`${file.name} : format non pris en charge`);
      continue;
    }
    if (file.size === 0) {
      rejected.push(`${file.name} : fichier vide`);
      continue;
    }
    if (file.size > UPLOAD_LIMITS.RUSH_MAX_BYTES) {
      rejected.push(`${file.name} : ${tooLargeMessage(UPLOAD_LIMITS.RUSH_MAX_BYTES)}`);
      continue;
    }
    const key = newBatchId();
    files.set(key, file);
    slotIds.set(key, slotId);
    ownerIds.set(key, ownerId);
    order += 1;
    added.push({
      key,
      batchId,
      fileName: file.name,
      size: file.size,
      phase: "pending",
      progress: 0,
      jobId: null,
      error: null,
      droppedAt,
      order,
    });
  }

  if (added.length > 0) {
    useUploadStore.setState((state) => ({ uploads: [...state.uploads, ...added] }));
    queue.push(...added.map((upload) => upload.key));
    pump();
  }
  return { accepted: added.length, rejected };
}

export function cancelUpload(key: string) {
  const queuedIndex = queue.indexOf(key);
  if (queuedIndex >= 0) {
    // Pas encore parti : aucun job serveur à supprimer.
    queue.splice(queuedIndex, 1);
    remove(key);
    return;
  }
  controllers.get(key)?.abort();
}

/** Relance un upload échoué depuis le début (nouveau job). */
export function retryUpload(key: string) {
  if (!files.has(key)) return;
  // L'ancien job a pu survivre à l'échec (suppression impossible hors ligne).
  const previousJobId = useUploadStore.getState().uploads.find((upload) => upload.key === key)?.jobId;
  if (previousJobId) void discardJob(previousJobId, null);
  update(key, { phase: "pending", progress: 0, error: null, jobId: null });
  queue.push(key);
  pump();
}

/** Retire de la liste un upload échoué. */
export function dismissUpload(key: string) {
  remove(key);
}

export function getBatchSettings(batchId: string): UploadSettings | undefined {
  return useUploadStore.getState().batchSettings[batchId];
}

export function setBatchSettings(batchId: string, settings: UploadSettings) {
  useUploadStore.setState((state) => ({ batchSettings: { ...state.batchSettings, [batchId]: settings } }));
}

export function onUploadServerEvent(listener: (event: UploadServerEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isSessionJob(jobId: string): boolean {
  return sessionJobIds.has(jobId);
}

// ─── Garde de fermeture ─────────────────────────────────────────────────────

function preventUnload(event: BeforeUnloadEvent) {
  event.preventDefault();
  event.returnValue = "";
}

/**
 * Fermer ou recharger l'onglet pendant un envoi demande confirmation. Posée au
 * niveau du MODULE, comme la file : elle reste active quand on a quitté la
 * page Transcription (les envois continuent en arrière-plan).
 */
if (typeof window !== "undefined") {
  let guarded = false;
  useUploadStore.subscribe((state) => {
    const active = state.uploads.some((upload) => isUploadActive(upload));
    if (active === guarded) return;
    guarded = active;
    if (active) window.addEventListener("beforeunload", preventUnload);
    else window.removeEventListener("beforeunload", preventUnload);
  });
}

// ─── Hook ───────────────────────────────────────────────────────────────────

/** État de la file pour le rendu. */
export function useTranscriptionUploads() {
  const uploads = useUploadStore((state) => state.uploads);
  const batchSettings = useUploadStore((state) => state.batchSettings);
  const hasActiveUploads = uploads.some((upload) => isUploadActive(upload));
  return { uploads, batchSettings, hasActiveUploads };
}

export type { TranscriptionUpload, UploadPhase };
