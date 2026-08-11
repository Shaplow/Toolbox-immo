"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAllJobEvents } from "@/lib/hooks/jobEventBus";
import {
  Mic,
  Upload,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  FileAudio,
  Play,
  RefreshCw,
  X,
  ArrowLeft,
  Languages,
} from "lucide-react";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { toast } from "@/components/ui/Toast";
import { fmtDate, fmtDuration } from "@/lib/jobUtils";
import { uploadFileInParts, createUploadHeartbeat } from "@/lib/upload/multipartClient";
import { UPLOAD_LIMITS, tooLargeMessage } from "@/lib/upload/limits";

const AUDIO_ACCEPT = ".mp3,.wav,.m4a,.flac,.ogg,.aac,.mp4,.mov,.mkv,.webm";
const MAX_UPLOAD_SIZE = UPLOAD_LIMITS.RUSH_MAX_BYTES; // source unique, alignée serveur

type Job = {
  id: string;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  inputFilename: string | null;
  model: string;
  language: string;
  /// Mode multi-langue : list de codes ISO (≥2). Vide pour mono. */
  languages?: string[];
  enableDiarization: boolean;
  hasDiarization: boolean;
  segmentCount: number | null;
  duration: number | null;
  createdAt: string;
  errorMsg: string | null;
};

type JobDraft = {
  language: string;
  enableDiarization: boolean;
};

type UploadState = {
  total: number;
  currentIndex: number;
  currentName: string;
  progress: number | null;
  completed: number;
};

type Feedback = {
  type: "success" | "error";
  message: string;
};

const DEFAULT_JOB_CONFIG: JobDraft = { language: "fr", enableDiarization: false };

const LANGUAGE_OPTIONS = [
  { value: "fr", label: "Français" },
  { value: "en", label: "Anglais" },
  { value: "es", label: "Espagnol" },
  { value: "de", label: "Allemand" },
  { value: "it", label: "Italien" },
  { value: "auto", label: "Détection auto" },
];

/** Catalogue des langues Whisper. Toujours affiché en multi-select badges.
 *  Une seule langue cochée → mode mono. Plusieurs → mode multi (bêta) auto. */
const LANGUAGE_BADGES = [
  { value: "fr", label: "Français" },
  { value: "zh", label: "Chinois" },
  { value: "en", label: "Anglais" },
  { value: "es", label: "Espagnol" },
  { value: "de", label: "Allemand" },
  { value: "it", label: "Italien" },
  { value: "pt", label: "Portugais" },
  { value: "ru", label: "Russe" },
  { value: "ja", label: "Japonais" },
  { value: "ko", label: "Coréen" },
  { value: "ar", label: "Arabe" },
];

const DEFAULT_LANGUAGES = ["fr"];

/** localStorage key — persiste les langues entre uploads. */
const LANGUAGES_LOCALSTORAGE_KEY = "transcription_languages_v1";

const STATUS_ICON: Record<Job["status"], React.ReactNode> = {
  QUEUED: <Clock className="h-4 w-4 text-warning-700" />,
  PROCESSING: <Loader2 className="h-4 w-4 animate-spin text-info-700" />,
  COMPLETED: <CheckCircle className="h-4 w-4 text-green-500" />,
  FAILED: <XCircle className="h-4 w-4 text-red-500" />,
};

const STATUS_LABEL: Record<Job["status"], string> = {
  QUEUED: "En attente",
  PROCESSING: "Analyse en cours",
  COMPLETED: "Terminé",
  FAILED: "Erreur",
};

const STATUS_TONE: Record<Job["status"], string> = {
  QUEUED: "bg-warning-50 text-warning-700",
  PROCESSING: "bg-info-50 text-info-700",
  COMPLETED: "bg-green-50 text-green-700",
  FAILED: "bg-red-50 text-red-700",
};


function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return await response.json() as T;
  } catch {
    return null;
  }
}

export function TranscriptionList({
  initialJobs,
  slotContext = null,
  returnTo = null,
}: {
  initialJobs: Job[];
  /** V2 friction MED-6 : si le tool est ouvert depuis une fiche publication
   *  (?slotId=X), on affiche un banner contextuel et on rattache la
   *  transcription au slot (sent dans le POST body). */
  slotContext?: { id: string; title: string | null; accountHandle: string } | null;
  /** Path de retour validé (ou null). Affiché en breadcrumb si présent. */
  returnTo?: string | null;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [dragging, setDragging] = useState(false);
  const defaultConfig = DEFAULT_JOB_CONFIG;
  // Langues sélectionnées (1 = mono, 2+ = multi auto). Restauré depuis
  // localStorage au mount, FR pré-coché par défaut.
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>(DEFAULT_LANGUAGES);
  const isMultilingual = selectedLanguages.length >= 2;
  const [queuedDrafts, setQueuedDrafts] = useState<Record<string, JobDraft>>({});
  const [dirtyJobIds, setDirtyJobIds] = useState<Record<string, boolean>>({});
  const [savingJobIds, setSavingJobIds] = useState<Record<string, boolean>>({});
  const [startingJobIds, setStartingJobIds] = useState<Record<string, boolean>>({});
  const [cancellingJobIds, setCancellingJobIds] = useState<Record<string, boolean>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState | null>(null);
  const [startingBatch, setStartingBatch] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [jobErrors, setJobErrors] = useState<Record<string, string>>({});

  const queuedJobs = jobs.filter((job) => job.status === "QUEUED");
  const processingJobs = jobs.filter((job) => job.status === "PROCESSING");
  const historyJobs = jobs.filter((job) => job.status === "COMPLETED" || job.status === "FAILED");
  const queueJobs = jobs.filter((job) => job.status === "QUEUED" || job.status === "PROCESSING");

  const getDraftForJob = useCallback((job: Job): JobDraft => {
    return queuedDrafts[job.id] ?? {
      language: job.language,
      enableDiarization: job.enableDiarization,
    };
  }, [queuedDrafts]);

  const refreshJobs = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/transcription", { cache: "no-store" });
      const payload = await readJson<{ jobs?: Job[]; error?: string }>(response);
      if (!response.ok) {
        throw new Error(payload?.error ?? `Erreur ${response.status}`);
      }
      setJobs(payload?.jobs ?? []);
    } catch (error) {
      setFeedback({
        type: "error",
        message: `Impossible d'actualiser la liste : ${getErrorMessage(error)}`,
      });
    } finally {
      setRefreshing(false);
    }
  }, []);

  const refreshProcessingJobs = useCallback(async () => {
    if (!processingJobs.length) return;

    try {
      const results = await Promise.all(
        processingJobs.map(async (job) => {
          const response = await fetch(`/api/transcription/${job.id}`, { cache: "no-store" });
          if (!response.ok) return null;
          return await readJson<Job>(response);
        })
      );

      const updates = new Map(
        results
          .filter((result): result is Job => result != null)
          .map((job) => [job.id, job])
      );

      if (updates.size > 0) {
        setJobs((currentJobs) =>
          currentJobs.map((job) => updates.get(job.id) ?? job)
        );
      }
    } catch {
      // Ignore background polling errors. The manual refresh remains available.
    }
  }, [processingJobs]);

  // Restaure les langues sélectionnées depuis localStorage au mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(LANGUAGES_LOCALSTORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const validCodes = new Set(LANGUAGE_BADGES.map((b) => b.value));
        const filtered = parsed.filter((c): c is string => typeof c === "string" && validCodes.has(c));
        if (filtered.length > 0) setSelectedLanguages(filtered);
      }
    } catch {
      // Ignore corrupted state
    }
  }, []);

  // Persiste les langues sélectionnées à chaque changement.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(LANGUAGES_LOCALSTORAGE_KEY, JSON.stringify(selectedLanguages));
    } catch {
      // localStorage quota / SSR — silent fail.
    }
  }, [selectedLanguages]);

  // SSE fast path — transcription jobs updated immediately when webhook fires
  useAllJobEvents((event) => {
    if (event.jobType !== "transcription") return;
    setJobs((currentJobs) => {
      const existing = currentJobs.find((j) => j.id === event.jobId);
      // V5.A.2 — Si on vient d'une fiche (slotContext) et qu'un job de cette
      // session termine, rebond auto fiche (cohérent avec CoverGenerator V2.1
      // et DescriptionTool V2.2). Délai 1.5s pour laisser voir le toast.
      if (
        existing &&
        event.status === "COMPLETED" &&
        slotContext &&
        returnTo
      ) {
        toast.success("Transcription terminée — retour à la publication.");
        setTimeout(() => router.push(returnTo), 1500);
      }
      return currentJobs.map((job) =>
        job.id === event.jobId
          ? {
              ...job,
              status: event.status as Job["status"],
              ...(typeof event.segmentCount === "number" ? { segmentCount: event.segmentCount } : {}),
              ...(typeof event.duration === "number" ? { duration: event.duration } : {}),
              ...(typeof event.hasDiarization === "boolean" ? { hasDiarization: event.hasDiarization } : {}),
            }
          : job
      );
    });
  });

  // Polling fallback — 10 s, backup when SSE unavailable (dev, no tunnel)
  useEffect(() => {
    if (!processingJobs.length) return;

    const interval = window.setInterval(() => {
      void refreshProcessingJobs();
    }, 10000);

    return () => window.clearInterval(interval);
  }, [processingJobs.length, refreshProcessingJobs]);

  const uploadToPresignedUrl = useCallback(
    (file: File, uploadUrl: string, onProgress: (progress: number) => void) => {
      return new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            onProgress(Math.round((event.loaded / event.total) * 100));
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
            return;
          }
          reject(new Error(`Upload R2 échoué : ${xhr.status}`));
        };
        xhr.onerror = () => reject(new Error("Erreur réseau pendant l'upload"));
        xhr.send(file);
      });
    },
    []
  );

  const prepareQueuedJobs = useCallback(async (files: File[]) => {
    if (!files.length) return;

    setFeedback(null);
    setUploadState({
      total: files.length,
      currentIndex: 0,
      currentName: "",
      progress: null,
      completed: 0,
    });

    let successCount = 0;
    const errors: string[] = [];

    for (const [index, file] of files.entries()) {
      try {
        const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

        if (file.size > MAX_UPLOAD_SIZE) {
          throw new Error(`${tooLargeMessage(MAX_UPLOAD_SIZE)}.`);
        }

        setUploadState({
          total: files.length,
          currentIndex: index + 1,
          currentName: file.name,
          progress: 0,
          completed: successCount,
        });

        const prepareResponse = await fetch("/api/transcription", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            ext,
            size: file.size,
            model: "turbo",
            // 1 langue cochée = mode mono, on envoie `language`.
            // 2+ langues = mode multi auto, on envoie `languages` qui déclenche
            // job_type="transcribe-multilingual" + traduction inverse auto.
            ...(isMultilingual
              ? { languages: selectedLanguages }
              : { language: selectedLanguages[0] ?? defaultConfig.language }),
            enable_diarization: defaultConfig.enableDiarization,
            // V2 friction MED-2/MED-6 : si on est dans le contexte d'un slot,
            // on rattache la transcription au slot pour qu'elle apparaisse
            // dans la ProductionChain de la fiche.
            ...(slotContext ? { slotId: slotContext.id } : {}),
          }),
        });
        const preparePayload = await readJson<{
          jobId?: string;
          uploadUrl?: string;
          multipart?: { uploadId: string; partSize: number; partUrls: { partNumber: number; url: string }[] };
          error?: string;
        }>(prepareResponse);
        if (!prepareResponse.ok) {
          throw new Error(preparePayload?.error ?? `Erreur ${prepareResponse.status}`);
        }
        const jobId = preparePayload?.jobId;
        if (!jobId || (!preparePayload.uploadUrl && !preparePayload.multipart)) {
          throw new Error("Le serveur n'a pas renvoyé de job en attente exploitable.");
        }

        const onProgress = (progress: number) => {
          setUploadState((currentState) => {
            if (!currentState) return currentState;
            return { ...currentState, progress };
          });
        };

        if (preparePayload.multipart) {
          // Upload multipart (fichier > 100 Mo) — obligatoire au-delà de 5 Go
          // (R2 refuse un PUT unique > 5 Go). Finalisé via /upload-complete ;
          // le multipart partiel est annulé (/upload-abort) en cas d'échec.
          const { uploadId, partSize, partUrls } = preparePayload.multipart;
          const abortController = new AbortController();
          // Signe de vie pendant l'upload : sur un gros rush le transfert dure des
          // heures sans rien écrire en DB, et le sweep admin passerait le job
          // QUEUED en FAILED au bout de 10 min (→ 409 à la finalisation).
          const heartbeat = createUploadHeartbeat(
            `/api/transcription/${jobId}/upload-heartbeat`,
            abortController.signal,
          );
          try {
            const parts = await uploadFileInParts(file, partUrls, partSize, {
              signal: abortController.signal,
              onProgress: (fraction) => {
                heartbeat();
                onProgress(Math.round(fraction * 100));
              },
            });
            const completeRes = await fetch(`/api/transcription/${jobId}/upload-complete`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ uploadId, parts }),
            });
            if (!completeRes.ok) {
              const data = await readJson<{ error?: string }>(completeRes);
              throw new Error(data?.error ?? `Erreur finalisation (${completeRes.status})`);
            }
          } catch (uploadErr) {
            void fetch(`/api/transcription/${jobId}/upload-abort`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ uploadId }),
            }).catch(() => {});
            throw uploadErr;
          }
        } else {
          await uploadToPresignedUrl(file, preparePayload.uploadUrl!, onProgress);
        }

        successCount += 1;
        setUploadState((currentState) => {
          if (!currentState) return currentState;
          return {
            ...currentState,
            completed: successCount,
            progress: 100,
          };
        });
      } catch (error) {
        errors.push(`${file.name} : ${getErrorMessage(error)}`);
      }
    }

    setUploadState(null);
    await refreshJobs();

    if (successCount > 0 && errors.length === 0) {
      setFeedback({
        type: "success",
        message: `${successCount} rush${successCount > 1 ? "s" : ""} ajouté${successCount > 1 ? "s" : ""} à la file d'attente.`,
      });
      return;
    }

    if (successCount > 0) {
      setFeedback({
        type: "error",
        message: `${successCount} rush${successCount > 1 ? "s" : ""} préparé${successCount > 1 ? "s" : ""}, ${errors.length} échec${errors.length > 1 ? "s" : ""}. ${errors[0]}`,
      });
      return;
    }

    setFeedback({
      type: "error",
      message: errors[0] ?? "Impossible de préparer les rushs pour la transcription.",
    });
  }, [defaultConfig, refreshJobs, uploadToPresignedUrl, slotContext, selectedLanguages, isMultilingual]);

  const handleFiles = useCallback(async (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []).filter((file) => file.size > 0);
    if (!files.length) return;
    await prepareQueuedJobs(files);
  }, [prepareQueuedJobs]);

  const handleDrop = useCallback(async (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    await handleFiles(event.dataTransfer.files);
  }, [handleFiles]);

  const handleFileInput = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    await handleFiles(event.target.files);
    event.target.value = "";
  }, [handleFiles]);

  const updateQueuedDraft = useCallback((job: Job, patch: Partial<JobDraft>) => {
    const currentDraft = queuedDrafts[job.id] ?? {
      model: job.model,
      language: job.language,
      enableDiarization: job.enableDiarization,
    };
    const nextDraft = { ...currentDraft, ...patch };

    setQueuedDrafts((currentDrafts) => ({
      ...currentDrafts,
      [job.id]: nextDraft,
    }));

    setDirtyJobIds((currentDirtyJobIds) => {
      const nextDirtyJobIds = { ...currentDirtyJobIds };
      const isDirty =
        nextDraft.language !== job.language ||
        nextDraft.enableDiarization !== job.enableDiarization;

      if (isDirty) {
        nextDirtyJobIds[job.id] = true;
      } else {
        delete nextDirtyJobIds[job.id];
      }

      return nextDirtyJobIds;
    });

    setJobErrors((currentJobErrors) => {
      const nextJobErrors = { ...currentJobErrors };
      delete nextJobErrors[job.id];
      return nextJobErrors;
    });
  }, [queuedDrafts]);

  const saveQueuedJobConfig = useCallback(async (job: Job) => {
    const draft = getDraftForJob(job);
    setSavingJobIds((currentSavingJobIds) => ({
      ...currentSavingJobIds,
      [job.id]: true,
    }));

    setJobErrors((currentJobErrors) => {
      const nextJobErrors = { ...currentJobErrors };
      delete nextJobErrors[job.id];
      return nextJobErrors;
    });

    try {
      const response = await fetch(`/api/transcription/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: draft.language,
          enable_diarization: draft.enableDiarization,
        }),
      });
      const payload = await readJson<(Job & { error?: string }) | { error?: string }>(response);
      if (!response.ok) {
        throw new Error(payload?.error ?? `Erreur ${response.status}`);
      }

      const updatedJob = {
        ...job,
        ...(payload as Job),
      };

      setJobs((currentJobs) =>
        currentJobs.map((candidate) => (candidate.id === job.id ? updatedJob : candidate))
      );
      setQueuedDrafts((currentDrafts) => ({
        ...currentDrafts,
        [job.id]: {
          language: updatedJob.language,
          enableDiarization: updatedJob.enableDiarization,
        },
      }));
      setDirtyJobIds((currentDirtyJobIds) => {
        const nextDirtyJobIds = { ...currentDirtyJobIds };
        delete nextDirtyJobIds[job.id];
        return nextDirtyJobIds;
      });

      return updatedJob;
    } catch (error) {
      const message = getErrorMessage(error);
      setJobErrors((currentJobErrors) => ({
        ...currentJobErrors,
        [job.id]: message,
      }));
      throw error;
    } finally {
      setSavingJobIds((currentSavingJobIds) => {
        const nextSavingJobIds = { ...currentSavingJobIds };
        delete nextSavingJobIds[job.id];
        return nextSavingJobIds;
      });
    }
  }, [getDraftForJob]);

  const startQueuedJob = useCallback(async (job: Job) => {
    setStartingJobIds((currentStartingJobIds) => ({
      ...currentStartingJobIds,
      [job.id]: true,
    }));

    setJobErrors((currentJobErrors) => {
      const nextJobErrors = { ...currentJobErrors };
      delete nextJobErrors[job.id];
      return nextJobErrors;
    });

    try {
      if (dirtyJobIds[job.id]) {
        await saveQueuedJobConfig(job);
      }

      const response = await fetch(`/api/transcription/${job.id}/submit`, { method: "POST" });
      const payload = await readJson<{ error?: string }>(response);
      if (!response.ok) {
        throw new Error(payload?.error ?? `Erreur ${response.status}`);
      }

      setJobs((currentJobs) =>
        currentJobs.map((candidate) => (
          candidate.id === job.id
            ? { ...candidate, status: "PROCESSING" }
            : candidate
        ))
      );
    } catch (error) {
      const message = getErrorMessage(error);
      setJobErrors((currentJobErrors) => ({
        ...currentJobErrors,
        [job.id]: message,
      }));
      throw error;
    } finally {
      setStartingJobIds((currentStartingJobIds) => {
        const nextStartingJobIds = { ...currentStartingJobIds };
        delete nextStartingJobIds[job.id];
        return nextStartingJobIds;
      });
    }
  }, [dirtyJobIds, saveQueuedJobConfig]);

  const startQueuedBatch = useCallback(async () => {
    if (!queuedJobs.length) return;

    setStartingBatch(true);
    setFeedback(null);

    const results = await Promise.allSettled(
      queuedJobs.map(async (job) => {
        await startQueuedJob(job);
        return job.id;
      })
    );

    const startedCount = results.filter((result) => result.status === "fulfilled").length;
    const failedCount = results.length - startedCount;

    await refreshJobs();

    if (failedCount === 0) {
      setFeedback({
        type: "success",
        message: `${startedCount} transcription${startedCount > 1 ? "s" : ""} lancée${startedCount > 1 ? "s" : ""}.`,
      });
    } else {
      setFeedback({
        type: "error",
        message: `${startedCount} transcription${startedCount > 1 ? "s" : ""} lancée${startedCount > 1 ? "s" : ""}, ${failedCount} échec${failedCount > 1 ? "s" : ""}.`,
      });
    }

    setStartingBatch(false);
  }, [queuedJobs, refreshJobs, startQueuedJob]);

  const cancelJob = useCallback(async (job: Job) => {
    setCancellingJobIds((prev) => ({ ...prev, [job.id]: true }));
    try {
      const response = await fetch(`/api/transcription/${job.id}`, { method: "DELETE" });
      if (!response.ok) return;
      setJobs((currentJobs) =>
        currentJobs.map((candidate) =>
          candidate.id === job.id
            ? { ...candidate, status: "FAILED", errorMsg: "Annulé" }
            : candidate
        )
      );
    } finally {
      setCancellingJobIds((prev) => {
        const next = { ...prev };
        delete next[job.id];
        return next;
      });
    }
  }, []);

  return (
    <div className="min-h-screen">
      <div
        className="mx-auto max-w-7xl px-6 py-8"

      >
        <div className="px-6 sm:px-8 pt-6 pb-12">
          <div className="max-w-5xl mx-auto space-y-6">
      {/* V2 friction MED-6 : breadcrumb retour si on vient d'une fiche. */}
      {returnTo && (
        <Link
          href={returnTo}
          className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-gray-900 transition-colors"
        >
          <ArrowLeft size={12} />
          Retour à la publication
        </Link>
      )}

      {/* V2 friction MED-6 : banner contextuel quand on est ouvert depuis un slot. */}
      {slotContext && (
        <div className="rounded-xl bg-gradient-to-b from-info-50/85 to-info-50/55 px-4 py-3 ">
          <p className="text-[10px] uppercase tracking-widest font-semibold text-info-700">
            Transcription pour une publication
          </p>
          <p className="mt-1 text-[13px] text-info-700">
            {slotContext.title ?? "Publication"} · @{slotContext.accountHandle}
          </p>
          <p className="mt-0.5 text-[11px] text-info-700/80">
            La transcription sera rattachée à cette publication et apparaîtra dans sa
            chaîne de production.
          </p>
        </div>
      )}

      <div>
        <ToolPageHeader
          icon={Mic}
          iconTint="sky"
          title="Transcription"
          subtitle="Uploadez vos rushs, laissez-les en attente, ajustez la config puis lancez une ou plusieurs transcriptions quand vous êtes prêt."
          actions={<RefreshButton title="Rafraîchir les jobs" />}
        />
        <div className="-mt-4 mb-2 flex flex-wrap gap-2 text-xs font-medium">
          <span className="rounded-full bg-warning-50 px-3 py-1 text-warning-700">
            {queuedJobs.length} en attente
          </span>
          <span className="rounded-full bg-info-50 px-3 py-1 text-info-700">
            {processingJobs.length} en cours
          </span>
          <span className="rounded-full bg-muted px-3 py-1 text-muted-foreground">
            {historyJobs.length} dans l&apos;historique
          </span>
        </div>
      </div>

      {/* Section Langues — toujours visible, FR coché par défaut.
          1 langue = mode mono. 2+ = mode multi auto (traduction inverse). */}
      <div className="rounded-2xl border border-white/50 bg-card border border-border px-4 py-3 ">
        <div className="flex items-center gap-2 mb-2">
          <Languages className="h-4 w-4 text-info-700" />
          <span className="text-sm font-semibold text-gray-900">Langues</span>
          {isMultilingual && (
            <span className="text-[10px] uppercase tracking-widest font-bold text-info-700">
              Multi · bêta
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {LANGUAGE_BADGES.map((option) => {
            const checked = selectedLanguages.includes(option.value);
            return (
              <label
                key={option.value}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium cursor-pointer transition-colors ${
                  checked
                    ? "bg-info-100 border-info-200 text-info-700"
                    : "bg-white border-border text-muted-foreground hover:border-info-200"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    setSelectedLanguages((current) => {
                      if (event.target.checked) {
                        if (current.includes(option.value)) return current;
                        return [...current, option.value];
                      }
                      // Ne jamais retomber à 0 langue — au moins une obligatoire.
                      const next = current.filter((code) => code !== option.value);
                      return next.length === 0 ? current : next;
                    });
                  }}
                  className="hidden"
                />
                {option.label}
              </label>
            );
          })}
        </div>
        {isMultilingual && (
          <p className="mt-2 text-[11px] text-info-700/80">
            Mode multi : {selectedLanguages.length} passes Whisper en séquence + traduction inverse auto. Temps de transcription ≈ × nombre de langues.
          </p>
        )}
      </div>

      <div
        role="button"
        tabIndex={0}
        className={`relative rounded-2xl border-2 border-dashed p-10 text-center transition-colors  ${
          dragging
            ? "border-info-200 bg-info-50/70"
            : "border-white/60 bg-white/60 hover:border-info-200 hover:bg-info-50/40"
        } ${uploadState ? "pointer-events-none opacity-80" : "cursor-pointer"}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragging(false);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => void handleDrop(event)}
        onClick={() => {
          if (!uploadState) fileInputRef.current?.click();
        }}
        onKeyDown={(event) => {
          if (!uploadState && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            fileInputRef.current?.click();
          }
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={AUDIO_ACCEPT}
          multiple
          className="hidden"
          onChange={(event) => void handleFileInput(event)}
        />

        {uploadState ? (
          <div className="mx-auto flex max-w-md flex-col items-center gap-4 text-info-700">
            <Loader2 className="h-8 w-8 animate-spin" />
            <div className="space-y-1">
              <p className="text-sm font-semibold">
                Préparation {uploadState.currentIndex}/{uploadState.total}
              </p>
              <p className="text-sm text-info-700">{uploadState.currentName}</p>
            </div>
            <div className="w-full space-y-2">
              <div className="h-2 overflow-hidden rounded-full bg-info-100">
                <div
                  className="h-full bg-info-600 transition-all duration-150"
                  style={{ width: `${uploadState.progress ?? 0}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-info-700">
                <span>{uploadState.progress ?? 0}%</span>
                <span>{uploadState.completed} rush prêt{uploadState.completed > 1 ? "s" : ""}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Upload className="h-8 w-8" />
            <div className="space-y-1">
              <p className="text-base font-medium text-foreground">Déposez un ou plusieurs rushs audio / vidéo</p>
              <p className="text-sm">mp3, wav, m4a, mp4, mov, mkv, webm... Les fichiers restent en attente jusqu&apos;au lancement manuel.</p>
            </div>
          </div>
        )}
      </div>

      {feedback && (
        <div className={`rounded-2xl px-4 py-3 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,1)] ${
          feedback.type === "success"
            ? "bg-gradient-to-b from-green-50/85 to-green-50/55 text-green-800 shadow-[inset_0_0_0_1px_rgba(134,239,172,0.40)]"
            : "bg-gradient-to-b from-danger-50/85 to-danger-50/55 text-danger-700 shadow-[inset_0_0_0_1px_rgba(244,114,182,0.30)]"
        }`}>
          {feedback.message}
        </div>
      )}

      <section className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-800">File de transcription</h2>
            <p className="text-sm text-muted-foreground">Les rushs ne partent plus automatiquement. Vous contrôlez le départ, un par un ou en lot.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void refreshJobs()}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-white px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-info-200 hover:text-info-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Actualiser
            </button>
            {queuedJobs.length > 0 && (
              <button
                type="button"
                onClick={() => void startQueuedBatch()}
                disabled={startingBatch}
                className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {startingBatch ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Lancer les {queuedJobs.length} en attente
              </button>
            )}
          </div>
        </div>

        {queueJobs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/60 bg-card border border-border px-6 py-10 text-center text-sm text-muted-foreground shadow-[inset_0_1px_0_rgba(255,255,255,1)]">
            Aucun rush en attente ou en cours. Ajoutez vos fichiers ci-dessus pour préparer un lot.
          </div>
        ) : (
          <ul className="space-y-3">
            {queueJobs.map((job) => {
              const draft = getDraftForJob(job);
              const isDirty = !!dirtyJobIds[job.id];
              const isSaving = !!savingJobIds[job.id];
              const isStarting = !!startingJobIds[job.id];

              return (
                <li key={job.id} className="rounded-xl border border-white/50 bg-card border border-border p-5 ">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex w-10 h-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                        <FileAudio className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 space-y-1">
                        <p className="truncate text-sm font-semibold text-gray-900">
                          {job.inputFilename ?? "Fichier inconnu"}
                        </p>
                        <p className="text-xs text-muted-foreground">Ajouté le {fmtDate(job.createdAt)}</p>
                      </div>
                    </div>

                    <div className={`inline-flex items-center gap-2 self-start rounded-full px-3 py-1 text-xs font-semibold ${STATUS_TONE[job.status]}`}>
                      {STATUS_ICON[job.status]}
                      {STATUS_LABEL[job.status]}
                    </div>

                    {/* Cancel button for active jobs */}
                    {(job.status === "QUEUED" || job.status === "PROCESSING") && (
                      <button
                        type="button"
                        onClick={() => void cancelJob(job)}
                        disabled={cancellingJobIds[job.id] || isStarting}
                        title="Annuler"
                        className="ml-auto shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-muted-foreground disabled:opacity-40 transition-colors"
                      >
                        {cancellingJobIds[job.id] ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                      </button>
                    )}
                  </div>

                  {job.status === "QUEUED" ? (
                    <div className="mt-4 space-y-3">
                      <div className="flex flex-wrap gap-4 items-end">
                        {job.languages && job.languages.length >= 2 ? (
                          <div className="space-y-1 min-w-[200px]">
                            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                              Langues (mode multi)
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              <span className="inline-flex items-center gap-1 rounded-full bg-info-100 px-2.5 py-1 text-xs font-semibold text-info-700">
                                <Languages className="h-3 w-3" />
                                {job.languages.join(" · ").toUpperCase()}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <label className="space-y-1 min-w-[150px]">
                            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Langue</span>
                            <select
                              value={draft.language}
                              onChange={(event) => updateQueuedDraft(job, { language: event.target.value })}
                              className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-info-600"
                            >
                              {LANGUAGE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                          </label>
                        )}

                        <label className="flex items-center gap-2.5 cursor-pointer pb-0.5">
                          <input
                            type="checkbox"
                            checked={draft.enableDiarization}
                            onChange={(event) => updateQueuedDraft(job, { enableDiarization: event.target.checked })}
                            className="h-4 w-4 rounded border-border text-info-700 focus:ring-info-600"
                          />
                          <span className="text-sm text-foreground">Identifier les intervenants</span>
                        </label>
                      </div>

                      {jobErrors[job.id] && (
                        <div className="rounded-xl bg-gradient-to-b from-danger-50/85 to-danger-50/55 px-4 py-3 text-sm text-danger-700 ">
                          {jobErrors[job.id]}
                        </div>
                      )}

                      <div className="flex flex-col gap-3 border-t border-white/40 pt-3 md:flex-row md:items-center md:justify-between">
                        <p className="text-sm text-muted-foreground">
                          Rush prêt. Lancez-le seul ou avec le lot complet.
                        </p>

                        <div className="flex flex-wrap items-center gap-2">
                          {isDirty && (
                            <button
                              type="button"
                              onClick={() => void saveQueuedJobConfig(job)}
                              disabled={isSaving || isStarting}
                              className="inline-flex items-center gap-2 rounded-xl border border-border bg-white px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-border disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                              Enregistrer
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              void startQueuedJob(job)
                                .then(() => {
                                  setFeedback({
                                    type: "success",
                                    message: `${job.inputFilename ?? "La transcription"} a été lancée.`,
                                  });
                                })
                                .catch(() => {
                                  // L'erreur reste affichée au niveau du job.
                                });
                            }}
                            disabled={isSaving || isStarting}
                            className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isStarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                            Lancer
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 flex flex-col gap-4 border-t border-white/40 pt-4 md:flex-row md:items-center md:justify-between">
                      <div className="flex flex-wrap gap-2 text-xs font-medium text-muted-foreground">
                        {job.languages && job.languages.length >= 2 ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-info-100 px-3 py-1 text-info-700">
                            <Languages className="h-3 w-3" />
                            {job.languages.join(" · ").toUpperCase()}
                          </span>
                        ) : (
                          <span className="rounded-full bg-muted px-3 py-1">{job.language.toUpperCase()}</span>
                        )}
                        {job.enableDiarization && (
                          <span className="rounded-full bg-info-50 px-3 py-1 text-info-700">Intervenants identifiés</span>
                        )}
                        {job.duration != null && (
                          <span className="rounded-full bg-muted px-3 py-1">{fmtDuration(job.duration)}</span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => router.push(`/transcriptions/${job.id}`)}
                        className="inline-flex items-center gap-2 rounded-xl border border-border bg-white px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-info-200 hover:text-info-700"
                      >
                        Ouvrir le détail
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {historyJobs.length > 0 && (
        <section className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-800">Historique</h2>
            <p className="text-sm text-muted-foreground">Les transcriptions terminées ou en échec restent accessibles ici.</p>
          </div>

          <ul className="space-y-3">
            {historyJobs.map((job) => (
              <li key={job.id} className="rounded-xl border border-white/50 bg-card border border-border p-5 ">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex w-10 h-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                      <FileAudio className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 space-y-1">
                      <p className="truncate text-sm font-semibold text-gray-900">
                        {job.inputFilename ?? "Fichier inconnu"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {fmtDate(job.createdAt)}
                        {job.duration != null && ` · ${fmtDuration(job.duration)}`}
                        {job.hasDiarization && " · Intervenants identifiés"}
                        {job.languages && job.languages.length >= 2 && ` · Multi (${job.languages.join("/").toUpperCase()})`}
                      </p>
                      {job.status === "FAILED" && job.errorMsg && (
                        <p className="text-xs text-red-500">{job.errorMsg}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${STATUS_TONE[job.status]}`}>
                      {STATUS_ICON[job.status]}
                      {STATUS_LABEL[job.status]}
                    </div>
                    <button
                      type="button"
                      onClick={() => router.push(`/transcriptions/${job.id}`)}
                      className="inline-flex items-center gap-2 rounded-xl border border-border bg-white px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-info-200 hover:text-info-700"
                    >
                      Ouvrir
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {/* Hint pagination : la page server fetch take: 50 ; on avertit si
              on atteint cette limite (heuristique : on inclut aussi les jobs
              en cours dans le compteur côté serveur, donc à 50 c'est plein). */}
          {jobs.length >= 50 && (
            <p className="text-center text-[11px] text-warning-700 pt-2">
              Affichage des 50 plus récents — d&apos;anciennes transcriptions
              ne sont pas listées ici.
            </p>
          )}
        </section>
      )}
          </div>
        </div>
      </div>
    </div>
  );
}
