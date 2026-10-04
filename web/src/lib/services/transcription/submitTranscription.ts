/**
 * submitTranscription — soumission d'un TranscriptionJob QUEUED au moteur.
 *
 * Deux temps volontairement séparés :
 *
 * 1. `claimTranscriptionForSubmit` (attendu par l'appelant) : vérifie que le job
 *    peut partir (configuration du moteur, source réellement uploadée), puis le
 *    passe QUEUED → PROCESSING de façon atomique. Toute erreur levée AVANT le
 *    claim laisse le job intact. Auparavant le claim précédait le HEAD R2 : un
 *    « Lancer » cliqué pendant un upload passait le job en FAILED définitif, et
 *    l'objet uploadé ensuite restait orphelin sur R2.
 *
 * 2. `dispatchTranscription` (en fond) : envoie à RunPod, ou au render-engine
 *    local en dev, puis écrit `runpodJobId`. En cas d'échec, le job passe FAILED,
 *    sa source est libérée et le client est prévenu par SSE (avant, l'échec
 *    d'envoi ne faisait ni l'un ni l'autre).
 *
 * Utilisé par POST /api/transcription/[id]/submit (unitaire) et par
 * POST /api/transcription/batches/[batchId]/launch (lot).
 */

import path from "path";
import { randomUUID } from "crypto";
import { mkdir, readFile, stat, writeFile } from "fs/promises";
import type { TranscriptionJob } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getR2PublicUrl, objectExistsInR2, r2Configured } from "@/lib/r2";
import { runpodConfigured, submitRunpodJob } from "@/lib/runpod";
import { getRunpodWebhookUrl } from "@/lib/webhooks/runpod";
import { notifyUser } from "@/lib/sseStore";
import { mapWithConcurrencySettled } from "@/lib/concurrency";
import { applyTranscriptionOutcome } from "@/lib/services/transcription/applyOutcome";
import { isAutoPipelineJob } from "@/lib/transcription/staleRules";
import { ConflictError, ServiceError, ValidationError } from "@/lib/services/_runtime/errors";

/** Claims simultanés lors d'un lancement en lot (HEAD R2 + 1 écriture DB chacun). */
const CLAIM_CONCURRENCY = 8;

/**
 * Envois RunPod simultanés lors d'un lancement en lot. Borne la rafale de
 * POST /run (le retry de submitRunpodJob n'a pas de jitter) sans ralentir le
 * lot : un envoi ne dure que le temps d'un aller-retour HTTP.
 */
const RUNPOD_DISPATCH_CONCURRENCY = 4;

const MIME_BY_EXT: Record<string, string> = {
  mp4: "video/mp4", mov: "video/quicktime", mkv: "video/x-matroska",
  webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav",
  m4a: "audio/mp4", flac: "audio/flac", ogg: "audio/ogg", aac: "audio/aac",
};

// ─── Erreurs ──────────────────────────────────────────────────────────────────

/** Source absente alors que l'upload n'est pas confirmé : il est encore en cours. */
export class UploadPendingError extends ServiceError {
  constructor() {
    super("UPLOAD_PENDING", "L'upload de ce fichier n'est pas terminé.", 409);
  }
}

export class EngineUnavailableError extends ServiceError {
  constructor(message: string) {
    super("ENGINE_UNAVAILABLE", message, 503);
  }
}

export class StorageUnavailableError extends ServiceError {
  constructor() {
    super(
      "STORAGE_UNAVAILABLE",
      "Impossible de vérifier le fichier source (R2 indisponible). Réessayez dans quelques instants.",
      503,
    );
  }
}

export const DIARIZATION_UNAVAILABLE_MESSAGE =
  "La diarisation n'est pas disponible sur ce serveur (HF_TOKEN non configuré).";

// ─── Mode moteur ──────────────────────────────────────────────────────────────

/** Sans R2, tout le flux est local (dev) : fichiers sous public/, render-engine local. */
function isLocalMode(): boolean {
  return !r2Configured();
}

function runpodCredentials(): { endpointId: string; apiKey: string } | null {
  const endpointId = process.env.RUNPOD_ENDPOINT_ID;
  const apiKey = process.env.RUNPOD_API_KEY;
  if (!endpointId || !apiKey || !runpodConfigured()) return null;
  return { endpointId, apiKey };
}

function localSourcePath(inputKey: string): string {
  return path.join(process.cwd(), "public", inputKey.replace(/^local\//, ""));
}

/**
 * Le média source est-il arrivé ? `local/…` : fichier sous public/ (dev) ;
 * sinon HEAD R2. Lève `StorageUnavailableError` si R2 ne répond pas : l'appelant
 * ne doit alors rien conclure.
 */
export async function transcriptionSourceExists(inputKey: string): Promise<boolean> {
  return sourceExists(inputKey, inputKey.startsWith("local/"));
}

async function sourceExists(inputKey: string, local: boolean): Promise<boolean> {
  if (local) {
    try {
      await stat(localSourcePath(inputKey));
      return true;
    } catch {
      return false;
    }
  }
  try {
    return await objectExistsInR2(inputKey);
  } catch (err) {
    console.error(`[transcription/submit] HEAD R2 échoué key=${inputKey}:`, err);
    throw new StorageUnavailableError();
  }
}

// ─── Claim ────────────────────────────────────────────────────────────────────

/**
 * Vérifie puis passe le job QUEUED → PROCESSING. Lève une `ServiceError` sans
 * toucher au job si quelque chose manque : un « Lancer » cliqué pendant l'upload
 * renvoie UPLOAD_PENDING et le job reste prêt à repartir.
 *
 * @returns Le job relu après le claim.
 */
export async function claimTranscriptionForSubmit(job: TranscriptionJob): Promise<TranscriptionJob> {
  if (job.status !== "QUEUED") throw new ConflictError("Job déjà soumis ou terminé");
  if (!job.inputKey) throw new ValidationError("Clé source manquante");

  const local = isLocalMode();
  if (!local && !runpodCredentials()) throw new EngineUnavailableError("RunPod non configuré");
  if (job.enableDiarization && !process.env.HF_TOKEN) {
    throw new EngineUnavailableError(DIARIZATION_UNAVAILABLE_MESSAGE);
  }

  // Upload confirmé (`uploadedAt`) : pas de HEAD — 50 appels R2 évités par lot.
  // Une source ne disparaît qu'à un état terminal (libération), or le job est QUEUED.
  if (!job.uploadedAt && !(await sourceExists(job.inputKey, local))) {
    throw new UploadPendingError();
  }

  const claimed = await prisma.transcriptionJob.updateMany({
    where: { id: job.id, status: "QUEUED" },
    data: { status: "PROCESSING", errorMsg: null, uploadedAt: job.uploadedAt ?? new Date() },
  });
  if (claimed.count === 0) throw new ConflictError("Job déjà soumis ou terminé");

  // Relecture : un réglage (PATCH, ou « intervenants » du lot) enregistré entre
  // la lecture du job et le claim doit partir avec le job. Après le claim, plus
  // aucun PATCH ne s'applique (ils sont gardés sur QUEUED).
  return prisma.transcriptionJob.findUniqueOrThrow({ where: { id: job.id } });
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

export type DispatchOptions = {
  /**
   * Interdit le chemin pod (cf. submitRunpodJob). Utilisé pour les lots : le pod
   * n'accepte qu'un job à la fois, et une rafale attendrait son démarrage (jusqu'à
   * ~10 min) pour n'y placer qu'une transcription.
   */
  serverlessOnly?: boolean;
};

export type DispatchResult =
  | { ok: true }
  /** `skipped` : rien n'a été tenté (job annulé ou déjà traité entre-temps). */
  | { ok: false; error: string; skipped?: boolean };

/** Longueur maximale d'un message d'erreur moteur affiché à l'utilisateur. */
const MAX_ENGINE_ERROR_LENGTH = 240;

/**
 * Envoi au moteur impossible pour un job claimé.
 *
 * Vidéo d'un dépôt standalone déjà uploadée : remise en attente avec le motif,
 * SOURCE CONSERVÉE. Une panne RunPod ou une clé invalide au moment de lancer un
 * lot de 50 vidéos ne doit pas les détruire toutes (il faudrait les ré-uploader) :
 * un nouveau clic sur « Lancer » suffit une fois le moteur revenu.
 * Pipeline auto : FAILED et source libérée par ses gardes, comme avant.
 */
async function handleDispatchFailure(job: TranscriptionJob, error: string): Promise<void> {
  if (!isAutoPipelineJob(job) && job.uploadedAt) {
    const message = `Envoi au moteur de transcription impossible (${error.slice(0, MAX_ENGINE_ERROR_LENGTH)}). Relancez la vidéo.`;
    const requeued = await prisma.transcriptionJob.updateMany({
      where: { id: job.id, status: "PROCESSING", runpodJobId: null },
      data: { status: "QUEUED", errorMsg: message },
    });
    if (requeued.count > 0) {
      notifyUser(job.userId, { jobType: "transcription", jobId: job.id, status: "QUEUED", errorMsg: message });
    }
    return;
  }
  await applyTranscriptionOutcome(job, { kind: "failed", errorMsg: error });
}

async function dispatchToRunpod(job: TranscriptionJob, opts: DispatchOptions): Promise<DispatchResult> {
  // En lot, l'envoi est borné : le job a pu être annulé (DELETE) ou tué en
  // attendant son tour. On ne l'envoie que s'il est toujours à envoyer, et on
  // touche `updatedAt` au passage : la fenêtre DISPATCH_STALL_MS de
  // staleRules part ainsi du vrai début de l'envoi, pas du clic.
  const stillPending = await prisma.transcriptionJob.updateMany({
    where: { id: job.id, status: "PROCESSING", runpodJobId: null },
    data: { updatedAt: new Date() },
  });
  if (stillPending.count === 0) return { ok: false, error: "Job annulé avant l'envoi", skipped: true };

  const credentials = runpodCredentials();
  if (!credentials || !job.inputKey) {
    const error = !credentials ? "RunPod non configuré" : "Clé source manquante";
    await handleDispatchFailure(job, error);
    return { ok: false, error };
  }

  const outputKey = job.outputJsonKey ?? `transcription/${job.userId}/${randomUUID()}/segments.json`;
  const isMultilingual = job.languages.length >= 2;
  const webhookUrl = getRunpodWebhookUrl("/api/webhooks/runpod/transcription");
  const payload = {
    input: {
      job_type: isMultilingual ? "transcribe-multilingual" : "transcribe",
      audio_url: getR2PublicUrl(job.inputKey),
      output_key: outputKey,
      job_id: job.id,
      model_size: job.model === "turbo" ? "large-v3-turbo" : job.model,
      ...(isMultilingual ? { languages: job.languages } : { language: job.language }),
      enable_diarization: job.enableDiarization,
      hf_token: job.enableDiarization ? (process.env.HF_TOKEN ?? null) : null,
    },
    ...(webhookUrl ? { webhook: webhookUrl } : {}),
  };

  try {
    const data = await submitRunpodJob<{ id: string }>(
      credentials.endpointId,
      credentials.apiKey,
      payload,
      { serverlessOnly: opts.serverlessOnly },
    );
    // Gardé par le statut : si le webhook est arrivé avant (job déjà terminé via
    // output.job_id) ou si le job a été annulé entre-temps, on n'y touche plus.
    await prisma.transcriptionJob.updateMany({
      where: { id: job.id, status: "PROCESSING" },
      data: { runpodJobId: data.id, outputJsonKey: outputKey },
    });
    return { ok: true };
  } catch (err) {
    console.error(`[transcription/dispatch] envoi RunPod échoué job=${job.id}:`, err);
    const error = String(err);
    await handleDispatchFailure(job, error);
    return { ok: false, error };
  }
}

type LocalTranscribeResponse = {
  segments: Array<{ start: number; end: number; text: string; speaker?: string; language?: string }>;
  segment_count: number;
  duration: number;
  language?: string;
  languages?: string[];
  has_diarization: boolean;
};

async function dispatchToLocalEngine(job: TranscriptionJob): Promise<DispatchResult> {
  const inputKey = job.inputKey;
  if (!inputKey) {
    await applyTranscriptionOutcome(job, { kind: "failed", errorMsg: "Clé source manquante" });
    return { ok: false, error: "Clé source manquante" };
  }

  try {
    const fileBuffer = await readFile(localSourcePath(inputKey));
    const ext = path.extname(inputKey).slice(1);
    const form = new FormData();
    form.append(
      "audio",
      new Blob([new Uint8Array(fileBuffer)], { type: MIME_BY_EXT[ext] ?? "application/octet-stream" }),
      job.inputFilename ?? `source.${ext}`,
    );
    form.append("model_size", job.model === "turbo" ? "large-v3-turbo" : job.model);
    const isMultilingual = job.languages.length >= 2;
    if (isMultilingual) {
      // L'endpoint local multilingue prend les langues en CSV — cf. render-engine/api.py.
      form.append("languages", job.languages.join(","));
    } else {
      form.append("language", job.language ?? "fr");
    }
    form.append("enable_diarization", String(job.enableDiarization));
    const hfToken = process.env.HF_TOKEN;
    if (job.enableDiarization && hfToken) form.append("hf_token", hfToken);

    const apiUrl = process.env.CAPTIONS_API_URL ?? "http://localhost:8000";
    const endpoint = isMultilingual ? "/api/transcribe-multilingual" : "/api/transcribe";
    // ⚠ Node 20 fetch a un headersTimeout undici interne câblé à 5 min : au-delà,
    // ce fetch lève UND_ERR_HEADERS_TIMEOUT alors que FastAPI travaille encore.
    // Limite connue du mode local (dev uniquement).
    const res = await fetch(`${apiUrl}${endpoint}`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(60 * 60 * 1000),
    });
    if (!res.ok) throw new Error(`render-engine ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as LocalTranscribeResponse;

    const outputRelPath = (job.outputJsonKey ?? "").replace(/^local\//, "");
    if (outputRelPath) {
      const outputFilePath = path.join(process.cwd(), "public", outputRelPath);
      await mkdir(path.dirname(outputFilePath), { recursive: true });
      await writeFile(outputFilePath, JSON.stringify(data.segments, null, 2));
    }

    const completed = await prisma.transcriptionJob.updateMany({
      where: { id: job.id, status: "PROCESSING" },
      data: {
        status: "COMPLETED",
        // Copie inline : sans R2, c'est ce que la chaîne aval sait relire.
        segmentsJson: JSON.stringify(data.segments),
        segmentCount: data.segment_count,
        duration: data.duration,
        hasDiarization: data.has_diarization,
      },
    });
    if (completed.count === 0) return { ok: false, error: "Job annulé pendant la transcription", skipped: true };

    notifyUser(job.userId, {
      jobType: "transcription",
      jobId: job.id,
      status: "COMPLETED",
      segmentCount: data.segment_count,
      duration: data.duration,
      hasDiarization: data.has_diarization,
    });

    // Mode multi : traduction inverse auto (gating interne — no-op en mono).
    void (async () => {
      try {
        const { triggerAutoTranslationForTranscription } = await import(
          "@/lib/triggerAutoTranslationFromTranscription"
        );
        await triggerAutoTranslationForTranscription(job.id);
      } catch (err) {
        console.error(`[transcription/dispatch] triggerAutoTranslation threw: ${String(err)}`);
      }
    })();

    return { ok: true };
  } catch (err) {
    console.error(`[transcription/dispatch] render-engine local échoué job=${job.id}:`, err);
    const error = String(err);
    // En local, l'« envoi » EST la transcription : l'échec peut venir du fichier
    // lui-même — pas de remise en attente, qui ferait boucler.
    await applyTranscriptionOutcome(job, { kind: "failed", errorMsg: error });
    return { ok: false, error };
  }
}

/**
 * Envoie un job claimé au moteur. Ne lève jamais : un échec passe le job FAILED
 * et se lit dans le résultat.
 */
export async function dispatchTranscription(
  job: TranscriptionJob,
  opts: DispatchOptions = {},
): Promise<DispatchResult> {
  try {
    return isLocalMode() ? await dispatchToLocalEngine(job) : await dispatchToRunpod(job, opts);
  } catch (err) {
    // Filet : les branches gèrent déjà leurs erreurs (ex. une panne DB pendant
    // handleDispatchFailure). Le job reste PROCESSING sans runpodJobId → staleRules.
    console.error(`[transcription/dispatch] erreur inattendue job=${job.id}:`, err);
    return { ok: false, error: String(err) };
  }
}

// ─── Envois en cours (process unique) ─────────────────────────────────────────

/**
 * Jobs claimés dont l'envoi n'est pas terminé : en attente dans le limiteur
 * d'un lot, ou en cours d'envoi. Process web unique (PM2 instances:1), donc un
 * registre en mémoire suffit. Les règles d'âge (expireStale) l'interrogent pour
 * ne pas remettre en attente un job simplement en file derrière les autres
 * quand RunPod répond lentement. Après un redémarrage, le registre est vide :
 * c'est justement le cas où la remise en attente doit s'appliquer.
 */
const pendingDispatch = new Set<string>();

export function isDispatchPending(jobId: string): boolean {
  return pendingDispatch.has(jobId);
}

/** Envoie en tenant le registre à jour. Ne lève jamais. */
export async function dispatchTracked(job: TranscriptionJob, opts: DispatchOptions = {}): Promise<DispatchResult> {
  pendingDispatch.add(job.id);
  try {
    return await dispatchTranscription(job, opts);
  } finally {
    pendingDispatch.delete(job.id);
  }
}

/**
 * Le moteur tourne-t-il dans ce process (render-engine local) plutôt que sur
 * RunPod ? Sans R2 (dev), ou USE_RUNPOD=false (le pipeline auto transcrit alors
 * en local même avec R2). Un job PROCESSING sans runpodJobId y est normal.
 */
export function transcriptionEngineIsLocal(): boolean {
  return process.env.USE_RUNPOD === "false" || !r2Configured();
}

// ─── Lancement en lot ─────────────────────────────────────────────────────────

export type LaunchResult =
  | { jobId: string; ok: true }
  | { jobId: string; ok: false; code: string; error: string };

/**
 * Claim borné de chaque job, puis envoi en fond des jobs claimés. Rend la main
 * dès les claims faits : l'envoi à RunPod n'est pas attendu (même modèle que la
 * soumission unitaire). Un échec de claim ne bloque pas les autres jobs.
 */
export async function launchTranscriptionJobs(jobs: TranscriptionJob[]): Promise<LaunchResult[]> {
  const settled = await mapWithConcurrencySettled(jobs, CLAIM_CONCURRENCY, (job) =>
    claimTranscriptionForSubmit(job),
  );

  const claimedJobs: TranscriptionJob[] = [];
  const results: LaunchResult[] = settled.map((outcome, index) => {
    const jobId = jobs[index].id;
    if (outcome.ok) {
      claimedJobs.push(outcome.value);
      return { jobId, ok: true };
    }
    const err = outcome.error;
    if (err instanceof ServiceError) return { jobId, ok: false, code: err.code, error: err.message };
    console.error(`[transcription/launch] claim échoué job=${jobId}:`, err);
    return { jobId, ok: false, code: "INTERNAL", error: "Erreur serveur" };
  });

  if (claimedJobs.length > 0) {
    for (const job of claimedJobs) pendingDispatch.add(job.id);
    // Local : le render-engine de dev ne sérialise rien (fichiers temporaires
    // nommés à la milliseconde, modèle chargé sans verrou) — un à la fois.
    const limit = isLocalMode() ? 1 : RUNPOD_DISPATCH_CONCURRENCY;
    // Disjoncteur (RunPod) : un échec de soumission est presque toujours
    // systémique (RunPod en panne, clé invalide). Les jobs suivants ne retentent
    // pas 50 fois en vain : ils sont remis en attente avec le même motif, prêts
    // à être relancés. Pas en local, où un échec peut tenir au fichier.
    const useBreaker = !isLocalMode();
    let breaker: string | null = null;
    void mapWithConcurrencySettled(claimedJobs, limit, async (job) => {
      try {
        if (breaker) {
          await handleDispatchFailure(job, breaker);
          return;
        }
        const result = await dispatchTranscription(job, { serverlessOnly: true });
        if (useBreaker && !result.ok && !result.skipped) breaker = result.error;
      } finally {
        pendingDispatch.delete(job.id);
      }
    }).catch((err) => console.error("[transcription/launch] dispatch en lot:", err));
  }

  return results;
}
