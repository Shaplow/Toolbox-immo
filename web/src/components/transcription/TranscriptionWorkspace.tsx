"use client";

/**
 * TranscriptionWorkspace — outil standalone /transcriptions, organisé en lots.
 *
 * Parcours visé : déposer ~50 vidéos d'un coup, régler « Identifier les
 * intervenants » pour tout le lot, lancer le lot en un clic, puis récupérer
 * tous les SRT dans un ZIP.
 *
 * Sources de vérité :
 * - jobs serveur (GET /api/transcription/batches), fusionnés par id à chaque
 *   rafraîchissement ;
 * - uploads en cours dans ce navigateur (useTranscriptionUploads) ;
 * - fusion des deux, ligne par ligne : workspaceModel.ts.
 *
 * Mise à jour : SSE (webhook RunPod → notifyUser) en chemin rapide, un
 * rafraîchissement de la liste toutes les 15 s tant qu'un job tourne, et un
 * filet de résolution RunPod borné (3 jobs/min) pour les environnements sans
 * webhook. Plus de GET par job toutes les 10 s : à 50 jobs, c'était 5 appels
 * RunPod par seconde.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileAudio, Mic, RefreshCw } from "lucide-react";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageShell } from "@/components/ui/PageShell";
import { toast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/useConfirm";
import { useAllJobEvents } from "@/lib/hooks/jobEventBus";
import { mapWithConcurrencySettled } from "@/lib/concurrency";
import { downloadFromApi } from "@/lib/triggerDownloads";
import {
  CANCELLED_ERROR_MSG,
  isTranscriptionStatus,
  mergeJobs,
  newBatchId,
  sanitizeZipStem,
  type BatchDownloadFormat,
  type TranscriptionJobSummary,
} from "@/lib/transcription/batches";
import { TranscriptionBatchCard } from "./TranscriptionBatchCard";
import { TranscriptionNewBatchCard, LANGUAGE_CHOICES } from "./TranscriptionNewBatchCard";
import type { RowBusy } from "./TranscriptionJobRow";
import {
  TRANSCRIPTION_ACCEPT,
  cancelUpload,
  dismissUpload,
  enqueueUploads,
  getBatchSettings,
  isSessionJob,
  onUploadServerEvent,
  retryUpload,
  setBatchSettings,
  useTranscriptionUploads,
  type UploadSettings,
} from "./useTranscriptionUploads";
import {
  buildWorkspaceBatches,
  isUploadActive,
  summarizeWorkspaceBatch,
  type BatchRow,
  type WorkspaceBatch,
  type WorkspaceBatchSummary,
} from "./workspaceModel";

const LANGUAGES_STORAGE_KEY = "transcription_languages_v1";
const DIARIZATION_STORAGE_KEY = "transcription_diarization_v1";

/** Rafraîchissement de la liste tant qu'un job tourne (le SSE reste le chemin rapide). */
const REFRESH_INTERVAL_MS = 15_000;
/** Filet sans webhook : interroge RunPod pour quelques jobs à la fois. */
const RESOLVE_INTERVAL_MS = 60_000;
const RESOLVE_PER_TICK = 3;
/**
 * Aucun événement SSE depuis ce délai alors que des jobs tournent : les
 * webhooks n'arrivent probablement pas (serveur redémarré, tunnel absent en
 * dev). Le filet accélère, sinon un lot de 50 resterait « En cours » 17 min.
 */
const SSE_SILENCE_MS = 120_000;
const RESOLVE_PER_TICK_WITHOUT_SSE = 10;
/** « Actualiser » : tous les jobs en cours sont interrogés (plafond de sécurité). */
const MANUAL_RESOLVE_MAX = 60;

type SlotContext = { id: string; title: string | null; accountHandle: string };

type LaunchResponse = {
  results?: Array<{ jobId: string; ok: boolean; code?: string; error?: string }>;
  started?: number;
  error?: string;
};

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count > 1 ? pluralForm : singular}`;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const VALID_LANGUAGES: ReadonlySet<string> = new Set(LANGUAGE_CHOICES.map((choice) => choice.value));

/** Réglages d'un lot existant : ceux de sa première vidéo. */
function settingsFromBatch(batch: WorkspaceBatch, fallback: UploadSettings): UploadSettings {
  const first = batch.rows.find((row) => row.job)?.job;
  if (!first) return fallback;
  return {
    languages: first.languages.length >= 2 ? first.languages : [first.language],
    enableDiarization: first.enableDiarization,
  };
}

export function TranscriptionWorkspace({
  userId,
  initialJobs,
  initialNextCursor,
  diarizationAvailable,
  slotContext = null,
  returnTo = null,
}: {
  /** Compte effectif (impersonation comprise) : propriétaire des fichiers déposés. */
  userId: string;
  initialJobs: TranscriptionJobSummary[];
  initialNextCursor: string | null;
  /** HF_TOKEN configuré côté serveur : sans lui, la diarisation est refusée. */
  diarizationAvailable: boolean;
  /** Ouvert depuis une fiche publication (?slotId=…) : jobs rattachés au slot. */
  slotContext?: SlotContext | null;
  /** Chemin de retour validé côté serveur. */
  returnTo?: string | null;
}) {
  const router = useRouter();
  const [jobs, setJobs] = useState<TranscriptionJobSummary[]>(initialJobs);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Réglages des prochains dépôts, persistés dans le navigateur.
  const [languages, setLanguages] = useState<string[]>(["fr"]);
  const [diarization, setDiarization] = useState(false);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [launching, setLaunching] = useState<Record<string, boolean>>({});
  const [downloading, setDownloading] = useState<Record<string, BatchDownloadFormat | null>>({});
  const [rowBusy, setRowBusy] = useState<Record<string, RowBusy>>({});

  const { confirm, dialog: confirmDialog } = useConfirm();

  const jobsRef = useRef(jobs);
  useEffect(() => {
    jobsRef.current = jobs;
  });
  /** Instant de réception des événements SSE terminaux, par job (cf. refresh). */
  const terminalEventAtRef = useRef(new Map<string, number>());
  /** Dernier événement SSE de transcription reçu (0 : aucun depuis l'ouverture). */
  const lastSseAtRef = useRef(0);
  /**
   * Jobs supprimés côté serveur depuis l'ouverture. Une réponse de liste partie
   * avant la suppression ne doit pas les réinsérer (mergeJobs ne retire rien).
   */
  const removedJobIdsRef = useRef(new Set<string>());
  const forgetJob = useCallback((jobId: string) => {
    removedJobIdsRef.current.add(jobId);
    setJobs((list) => list.filter((job) => job.id !== jobId));
  }, []);
  const addFilesInputRef = useRef<HTMLInputElement>(null);
  const addFilesTargetRef = useRef<{ batchId: string; settings: UploadSettings } | null>(null);

  // ── Persistance des réglages ───────────────────────────────────────────────
  useEffect(() => {
    let storedLanguages: string[] = [];
    let storedDiarization = false;
    try {
      const rawLanguages = window.localStorage.getItem(LANGUAGES_STORAGE_KEY);
      const parsed: unknown = rawLanguages ? JSON.parse(rawLanguages) : null;
      if (Array.isArray(parsed)) {
        storedLanguages = parsed.filter(
          (code): code is string => typeof code === "string" && VALID_LANGUAGES.has(code),
        );
      }
      storedDiarization = window.localStorage.getItem(DIARIZATION_STORAGE_KEY) === "true";
    } catch {
      // localStorage indisponible ou corrompu : réglages par défaut.
    }
    // Lecture au montage seulement (pas au rendu SSR, où localStorage n'existe pas).
    if (storedLanguages.length > 0) setLanguages(storedLanguages);
    if (storedDiarization) setDiarization(true);
  }, []);

  const changeLanguages = useCallback((next: string[]) => {
    setLanguages(next);
    try {
      window.localStorage.setItem(LANGUAGES_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // localStorage indisponible.
    }
  }, []);

  const changeDiarization = useCallback((next: boolean) => {
    setDiarization(next);
    try {
      window.localStorage.setItem(DIARIZATION_STORAGE_KEY, String(next));
    } catch {
      // localStorage indisponible.
    }
  }, []);

  // ── Rafraîchissement ───────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    const startedAt = Date.now();
    const res = await fetch("/api/transcription/batches", { cache: "no-store" });
    if (!res.ok) throw new Error(await readError(res));
    const page = (await res.json()) as { jobs: TranscriptionJobSummary[] };
    setJobs((current) => {
      const byId = new Map(current.map((job) => [job.id, job]));
      // Une réponse partie AVANT un événement SSE terminal ne doit pas le défaire
      // (« Terminée » qui redeviendrait « En cours » jusqu'au rafraîchissement
      // suivant). Une remise à zéro légitime arrive dans une réponse ultérieure.
      const incoming = page.jobs.filter((job) => {
        if (removedJobIdsRef.current.has(job.id)) return false;
        const previous = byId.get(job.id);
        const terminalAt = terminalEventAtRef.current.get(job.id);
        return !(
          previous &&
          (previous.status === "COMPLETED" || previous.status === "FAILED") &&
          (job.status === "QUEUED" || job.status === "PROCESSING") &&
          terminalAt !== undefined &&
          terminalAt >= startedAt
        );
      });
      return mergeJobs(current, incoming);
    });
  }, []);

  const refreshTimerRef = useRef<number | null>(null);
  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current !== null) return;
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void refresh().catch(() => undefined);
    }, 400);
  }, [refresh]);
  useEffect(
    () => () => {
      if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
    },
    [],
  );

  // ── Uploads ────────────────────────────────────────────────────────────────
  // File de module (useTranscriptionUploads.ts) : elle survit à la navigation.
  const { uploads, batchSettings } = useTranscriptionUploads();

  useEffect(
    () =>
      onUploadServerEvent((event) => {
        // Upload échoué ou annulé : le job a été supprimé côté serveur.
        if (event.type === "removed") forgetJob(event.jobId);
        scheduleRefresh();
      }),
    [forgetJob, scheduleRefresh],
  );

  const handleFiles = useCallback(
    (dropped: File[], target?: { batchId: string; settings: UploadSettings }) => {
      // Depuis une publication : une seule vidéo (un lot rattacherait N
      // transcriptions au même slot). Le glisser-déposer peut en apporter plus.
      const files = slotContext ? dropped.slice(0, 1) : dropped;
      if (files.length < dropped.length) {
        toast.info(
          `Une seule vidéo par publication : ${plural(dropped.length - files.length, "fichier ignoré", "fichiers ignorés")}.`,
        );
      }
      const batchId = target?.batchId ?? newBatchId();
      if (!getBatchSettings(batchId)) {
        setBatchSettings(
          batchId,
          target?.settings ?? { languages, enableDiarization: diarizationAvailable && diarization },
        );
      }
      const { accepted, rejected } = enqueueUploads(files, batchId, slotContext?.id ?? null, userId);
      if (rejected.length > 0) {
        toast.error(
          rejected.length === 1
            ? `Fichier ignoré : ${rejected[0]}`
            : `${rejected.length} fichiers ignorés, dont ${rejected[0]}`,
        );
      }
      if (accepted > 0) setExpanded((current) => ({ ...current, [batchId]: true }));
    },
    [diarization, diarizationAvailable, languages, slotContext, userId],
  );

  // ── SSE : statut des jobs en temps réel ─────────────────────────────────────
  useAllJobEvents((event) => {
    if (event.jobType !== "transcription" || !isTranscriptionStatus(event.status)) return;
    lastSseAtRef.current = Date.now();
    const status = event.status;
    if (status === "COMPLETED" || status === "FAILED") terminalEventAtRef.current.set(event.jobId, Date.now());
    if (!jobsRef.current.some((job) => job.id === event.jobId)) {
      scheduleRefresh();
      return;
    }
    setJobs((current) =>
      current.map((job) =>
        job.id === event.jobId
          ? {
              ...job,
              status,
              ...(typeof event.segmentCount === "number" ? { segmentCount: event.segmentCount } : {}),
              ...(typeof event.duration === "number" ? { duration: event.duration } : {}),
              ...(typeof event.hasDiarization === "boolean" ? { hasDiarization: event.hasDiarization } : {}),
              ...(typeof event.errorMsg === "string" ? { errorMsg: event.errorMsg } : {}),
            }
          : job,
      ),
    );
    // Ouvert depuis une publication : retour quand les transcriptions lancées
    // ici sont toutes terminées (pas à la première d'un lot).
    if (status === "COMPLETED" && slotContext && returnTo && isSessionJob(event.jobId)) {
      const othersActive = jobsRef.current.some(
        (job) =>
          job.id !== event.jobId &&
          isSessionJob(job.id) &&
          (job.status === "QUEUED" || job.status === "PROCESSING"),
      );
      if (!othersActive) {
        toast.success("Transcription terminée : retour à la publication.");
        window.setTimeout(() => router.push(returnTo), 1500);
      }
    }
  });

  // ── Rafraîchissement périodique + filet de résolution RunPod ───────────────
  const hasProcessing = jobs.some((job) => job.status === "PROCESSING");
  const resolvedAtRef = useRef(new Map<string, number>());

  /** Interroge RunPod (via GET /api/transcription/[id]) pour les jobs les moins récemment vérifiés. */
  const resolveProcessing = useCallback(
    async (max: number) => {
      const processing = jobsRef.current
        .filter((job) => job.status === "PROCESSING")
        .sort((a, b) => (resolvedAtRef.current.get(a.id) ?? 0) - (resolvedAtRef.current.get(b.id) ?? 0))
        .slice(0, max);
      const outcomes = await mapWithConcurrencySettled(processing, 3, async (job) => {
        resolvedAtRef.current.set(job.id, Date.now());
        const res = await fetch(`/api/transcription/${job.id}`, { cache: "no-store" });
        if (!res.ok) return false;
        const data = (await res.json()) as { status?: string };
        return data.status !== "PROCESSING";
      });
      return outcomes.some((outcome) => outcome.ok && outcome.value);
    },
    [],
  );

  useEffect(() => {
    if (!hasProcessing) return;
    const watchStartedAt = Date.now();
    const refreshId = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh().catch(() => undefined);
    }, REFRESH_INTERVAL_MS);
    const resolveId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const sseSilentSince = Math.max(lastSseAtRef.current, watchStartedAt);
      const perTick =
        Date.now() - sseSilentSince > SSE_SILENCE_MS ? RESOLVE_PER_TICK_WITHOUT_SSE : RESOLVE_PER_TICK;
      void resolveProcessing(perTick).then((changed) => {
        if (changed) scheduleRefresh();
      });
    }, RESOLVE_INTERVAL_MS);
    return () => {
      window.clearInterval(refreshId);
      window.clearInterval(resolveId);
    };
  }, [hasProcessing, refresh, resolveProcessing, scheduleRefresh]);

  const manualRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await resolveProcessing(MANUAL_RESOLVE_MAX);
      await refresh();
    } catch (error) {
      toast.error(`Actualisation impossible : ${errorMessage(error)}`);
    } finally {
      setRefreshing(false);
    }
  }, [refresh, resolveProcessing]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/transcription/batches?cursor=${encodeURIComponent(nextCursor)}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await readError(res));
      const page = (await res.json()) as { jobs: TranscriptionJobSummary[]; nextCursor: string | null };
      setJobs((current) => mergeJobs(current, page.jobs.filter((job) => !removedJobIdsRef.current.has(job.id))));
      setNextCursor(page.nextCursor);
    } catch (error) {
      toast.error(`Chargement impossible : ${errorMessage(error)}`);
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor]);

  // ── Actions de lot ─────────────────────────────────────────────────────────
  const toggleBatchDiarization = useCallback(
    async (batch: WorkspaceBatch, value: boolean) => {
      const batchId = batch.batchId;
      if (!batchId) return;
      const current = getBatchSettings(batchId) ?? settingsFromBatch(batch, { languages, enableDiarization: false });
      setBatchSettings(batchId, { ...current, enableDiarization: value });
      setJobs((list) =>
        list.map((job) =>
          job.batchId === batchId && job.status === "QUEUED" ? { ...job, enableDiarization: value } : job,
        ),
      );
      try {
        const res = await fetch(`/api/transcription/batches/${batchId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enable_diarization: value }),
        });
        if (!res.ok) throw new Error(await readError(res));
      } catch (error) {
        toast.error(`Réglage non enregistré : ${errorMessage(error)}`);
        setBatchSettings(batchId, current);
        void refresh().catch(() => undefined);
      }
    },
    [languages, refresh],
  );

  const launchBatch = useCallback(
    async (batch: WorkspaceBatch) => {
      if (!batch.batchId) return;
      setLaunching((current) => ({ ...current, [batch.key]: true }));
      try {
        const res = await fetch(`/api/transcription/batches/${batch.batchId}/launch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        const data = (await res.json().catch(() => ({}))) as LaunchResponse;
        if (!res.ok) {
          toast.error(data.error ?? `Lancement impossible (erreur ${res.status})`);
          return;
        }
        const results = data.results ?? [];
        const startedIds = new Set(results.filter((result) => result.ok).map((result) => result.jobId));
        setJobs((list) =>
          list.map((job) => (startedIds.has(job.id) ? { ...job, status: "PROCESSING", errorMsg: null } : job)),
        );
        const failures = results.filter((result) => !result.ok);
        const startedLabel = plural(startedIds.size, "transcription lancée", "transcriptions lancées");
        if (failures.length === 0) {
          toast.success(startedLabel);
        } else {
          toast.error(
            `${startedLabel} · ${plural(failures.length, "échec", "échecs")} : ${failures[0].error ?? "erreur inconnue"}`,
          );
        }
      } catch {
        toast.error("Lancement impossible : erreur réseau.");
      } finally {
        setLaunching((current) => ({ ...current, [batch.key]: false }));
        scheduleRefresh();
      }
    },
    [scheduleRefresh],
  );

  const downloadBatch = useCallback(async (batch: WorkspaceBatch, format: BatchDownloadFormat) => {
    if (!batch.batchId) return;
    setDownloading((current) => ({ ...current, [batch.key]: format }));
    try {
      const res = await downloadFromApi(
        `/api/transcription/batches/${batch.batchId}/download?format=${format}`,
        `transcriptions-${format}.zip`,
      );
      const unreadable = Number(res.headers.get("X-Transcription-Errors") ?? "0");
      if (unreadable > 0) {
        toast.info(
          `ZIP téléchargé, sauf ${plural(unreadable, "transcription illisible", "transcriptions illisibles")} (détail dans ERREURS.txt)`,
        );
      }
    } catch (error) {
      toast.error(`Téléchargement impossible : ${errorMessage(error)}`);
    } finally {
      setDownloading((current) => ({ ...current, [batch.key]: null }));
    }
  }, []);

  const addFilesToBatch = useCallback(
    (batch: WorkspaceBatch) => {
      if (!batch.batchId) return;
      const settings =
        getBatchSettings(batch.batchId) ??
        settingsFromBatch(batch, { languages, enableDiarization: diarizationAvailable && diarization });
      addFilesTargetRef.current = { batchId: batch.batchId, settings };
      addFilesInputRef.current?.click();
    },
    [diarization, diarizationAvailable, languages],
  );

  // ── Actions de ligne ───────────────────────────────────────────────────────
  const setBusy = useCallback((key: string, value: RowBusy) => {
    setRowBusy((current) => ({ ...current, [key]: value }));
  }, []);

  const patchRow = useCallback(
    async (row: BatchRow, patch: { language?: string; enable_diarization?: boolean }) => {
      const original = row.job;
      if (!original) return;
      setJobs((list) =>
        list.map((job) =>
          job.id === original.id
            ? {
                ...job,
                ...(patch.language !== undefined ? { language: patch.language } : {}),
                ...(patch.enable_diarization !== undefined ? { enableDiarization: patch.enable_diarization } : {}),
              }
            : job,
        ),
      );
      setBusy(row.key, "patch");
      try {
        const res = await fetch(`/api/transcription/${original.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error(await readError(res));
      } catch (error) {
        toast.error(`Réglage non enregistré : ${errorMessage(error)}`);
        setJobs((list) => list.map((job) => (job.id === original.id ? original : job)));
      } finally {
        setBusy(row.key, null);
      }
    },
    [setBusy],
  );

  const launchRow = useCallback(
    async (row: BatchRow) => {
      const job = row.job;
      if (!job) return;
      setBusy(row.key, "launch");
      try {
        const res = await fetch(`/api/transcription/${job.id}/submit`, { method: "POST" });
        if (!res.ok) throw new Error(await readError(res));
        setJobs((list) =>
          list.map((candidate) =>
            candidate.id === job.id ? { ...candidate, status: "PROCESSING", errorMsg: null } : candidate,
          ),
        );
      } catch (error) {
        toast.error(`${job.inputFilename ?? "Transcription"} : ${errorMessage(error)}`);
      } finally {
        setBusy(row.key, null);
        scheduleRefresh();
      }
    },
    [scheduleRefresh, setBusy],
  );

  const cancelRow = useCallback(
    async (row: BatchRow) => {
      if (row.upload && isUploadActive(row.upload)) {
        cancelUpload(row.upload.key);
        return;
      }
      const job = row.job;
      if (!job) return;
      // Une vidéo envoyée (ou en cours de transcription) est supprimée à
      // l'annulation : on confirme. Un envoi inachevé part sans question.
      if (job.status === "PROCESSING" || job.uploadedAt) {
        const ok = await confirm({
          title: job.status === "PROCESSING" ? "Annuler cette transcription ?" : "Retirer cette vidéo ?",
          description: `${job.inputFilename ?? "La vidéo"} sera supprimée du stockage : il faudra la redéposer pour la transcrire.`,
          confirmLabel: job.status === "PROCESSING" ? "Annuler la transcription" : "Retirer",
          cancelLabel: "Garder",
          variant: "danger",
        });
        if (!ok) return;
      }
      setBusy(row.key, "cancel");
      try {
        const res = await fetch(`/api/transcription/${job.id}`, { method: "DELETE" });
        // 404 : déjà supprimé ailleurs (autre onglet, envoi échoué) → on l'oublie.
        if (res.status === 404) {
          forgetJob(job.id);
          return;
        }
        if (!res.ok) throw new Error(await readError(res));
        const data = (await res.json().catch(() => ({}))) as { deleted?: boolean };
        if (data.deleted) {
          forgetJob(job.id);
          return;
        }
        setJobs((list) =>
          list.map((candidate) =>
                candidate.id === job.id
                  ? { ...candidate, status: "FAILED", errorMsg: CANCELLED_ERROR_MSG }
                  : candidate,
              ),
        );
      } catch (error) {
        toast.error(`Annulation impossible : ${errorMessage(error)}`);
      } finally {
        setBusy(row.key, null);
      }
    },
    [confirm, forgetJob, setBusy],
  );

  const downloadRowSrt = useCallback(
    async (row: BatchRow) => {
      const job = row.job;
      if (!job) return;
      setBusy(row.key, "download");
      try {
        await downloadFromApi(
          `/api/transcription/${job.id}/download?format=srt`,
          `${sanitizeZipStem(job.inputFilename, "transcription")}.srt`,
        );
      } catch (error) {
        toast.error(`Téléchargement impossible : ${errorMessage(error)}`);
      } finally {
        setBusy(row.key, null);
      }
    },
    [setBusy],
  );

  // ── Rendu ──────────────────────────────────────────────────────────────────
  const sections = useMemo(() => {
    const batches = buildWorkspaceBatches(jobs, uploads);
    const withSummary = batches.map((batch) => ({
      batch,
      summary: summarizeWorkspaceBatch(
        batch,
        batch.batchId ? (batchSettings[batch.batchId]?.enableDiarization ?? false) : false,
      ),
    }));
    return {
      active: withSummary.filter((entry) => entry.summary.isActive),
      finished: withSummary.filter((entry) => !entry.summary.isActive),
    };
  }, [batchSettings, jobs, uploads]);

  const renderBatch = (entry: { batch: WorkspaceBatch; summary: WorkspaceBatchSummary }, defaultExpanded: boolean) => {
    const { batch, summary } = entry;
    const isExpanded = expanded[batch.key] ?? defaultExpanded;
    return (
      <TranscriptionBatchCard
        key={batch.key}
        batch={batch}
        summary={summary}
        expanded={isExpanded}
        onToggleExpanded={() => setExpanded((current) => ({ ...current, [batch.key]: !isExpanded }))}
        diarizationAvailable={diarizationAvailable}
        launching={launching[batch.key] ?? false}
        downloading={downloading[batch.key] ?? null}
        rowBusy={(row) => rowBusy[row.key] ?? null}
        onToggleDiarization={(value) => void toggleBatchDiarization(batch, value)}
        onLaunch={() => void launchBatch(batch)}
        onDownload={(format) => void downloadBatch(batch, format)}
        onAddFiles={() => addFilesToBatch(batch)}
        onPatchRow={(row, patch) => void patchRow(row, patch)}
        onLaunchRow={(row) => void launchRow(row)}
        onCancelRow={(row) => void cancelRow(row)}
        onDownloadRowSrt={(row) => void downloadRowSrt(row)}
        onRetryRow={(row) => row.upload && retryUpload(row.upload.key)}
        onDismissRow={(row) => row.upload && dismissUpload(row.upload.key)}
        onRetryFailedUploads={() => {
          for (const row of batch.rows) if (row.upload?.phase === "error") retryUpload(row.upload.key);
        }}
        canAddFiles={!slotContext}
      />
    );
  };

  return (
    <PageShell variant="default">
      <div className="space-y-6">
        <ToolPageHeader
          icon={Mic}
          title="Transcription"
          subtitle="Déposez vos vidéos par lots, réglez les intervenants pour tout le lot, lancez-le en un clic puis récupérez tous les SRT dans un ZIP."
          breadcrumb={
            returnTo ? (
              <Link href={returnTo} className="inline-flex items-center gap-1 hover:text-foreground">
                <ArrowLeft size={12} />
                Retour à la publication
              </Link>
            ) : undefined
          }
          actions={
            <Button variant="secondary" size="sm" icon={RefreshCw} loading={refreshing} onClick={() => void manualRefresh()}>
              Actualiser
            </Button>
          }
        />

        {slotContext && (
          <Alert variant="info" title="Transcription pour une publication">
            {slotContext.title ?? "Publication"} · @{slotContext.accountHandle}. Les transcriptions lancées ici
            seront rattachées à cette publication et apparaîtront dans sa chaîne de production.
          </Alert>
        )}

        <TranscriptionNewBatchCard
          languages={languages}
          onLanguagesChange={changeLanguages}
          diarization={diarization}
          onDiarizationChange={changeDiarization}
          diarizationAvailable={diarizationAvailable}
          // Depuis une publication : une vidéo, celle de la publication. Un lot
          // rattacherait N transcriptions au même slot.
          multiple={!slotContext}
          onFiles={(files) => handleFiles(files)}
        />

        <input
          ref={addFilesInputRef}
          type="file"
          accept={TRANSCRIPTION_ACCEPT}
          multiple
          className="hidden"
          onChange={(event) => {
            const target = addFilesTargetRef.current;
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (target && files.length > 0) handleFiles(files, target);
          }}
        />

        {sections.active.length === 0 && sections.finished.length === 0 ? (
          <EmptyState
            icon={FileAudio}
            title="Aucune transcription pour l'instant"
            description="Déposez des vidéos ci-dessus : elles forment un lot, que vous lancez en un clic."
          />
        ) : (
          <>
            {sections.active.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-foreground">En cours</h2>
                {sections.active.map((entry) => renderBatch(entry, true))}
              </section>
            )}
            {sections.finished.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-foreground">Terminés</h2>
                {sections.finished.map((entry, index) =>
                  // Rien en cours : le dernier lot terminé reste ouvert, pour ses SRT.
                  renderBatch(entry, sections.active.length === 0 && index === 0),
                )}
              </section>
            )}
          </>
        )}

        {confirmDialog}

        {nextCursor && (
          <div className="flex justify-center">
            <Button variant="ghost" size="sm" loading={loadingMore} onClick={() => void loadMore()}>
              Afficher les transcriptions plus anciennes
            </Button>
          </div>
        )}
      </div>
    </PageShell>
  );
}
