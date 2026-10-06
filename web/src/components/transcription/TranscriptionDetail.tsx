"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, CheckCircle, XCircle, Loader2, Clock,
  Download, FileText, FileJson, Layers, Mic2, RefreshCw, Scissors, ArrowRight,
} from "lucide-react";
import { useJobPolling } from "@/lib/hooks/useJobPolling";
import { useJobEvent } from "@/lib/hooks/jobEventBus";
import { toast } from "@/components/ui/Toast";
import { downloadFromApi } from "@/lib/triggerDownloads";
import { CANCELLED_ERROR_MSG } from "@/lib/transcription/batches";

type JobDetail = {
  id: string;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  inputFilename: string | null;
  model: string;
  language: string;
  /** Mode multi-langue (≥2 codes ISO). Vide pour les jobs mono historiques. */
  languages?: string[];
  enableDiarization: boolean;
  hasDiarization: boolean;
  segmentCount: number | null;
  duration: number | null;
  createdAt: string;
  errorMsg: string | null;
  hasOutput: boolean;
  /** Upload confirmé : une vidéo QUEUED est alors prête, en attente de lancement. */
  uploadedAt?: string | null;
};

function fmtDuration(seconds: number | null): string {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}min`;
  return `${m}min ${String(s).padStart(2, "0")}s`;
}

const LANG_LABELS: Record<string, string> = {
  fr: "Français", en: "Anglais", es: "Espagnol", de: "Allemand", it: "Italien",
  zh: "Chinois", pt: "Portugais", ru: "Russe", ja: "Japonais", ko: "Coréen", ar: "Arabe",
};

function languageBadgeLabel(job: { language: string; languages?: string[] }): string {
  if (job.languages && job.languages.length >= 2) {
    return "Multi · " + job.languages.map((c) => c.toUpperCase()).join(" / ");
  }
  return LANG_LABELS[job.language] ?? job.language;
}

const MODEL_LABELS: Record<string, string> = {
  turbo: "Rapide",
  "large-v3-turbo": "Rapide",
  "large-v3": "Haute précision",
  medium: "Medium",
};

export function TranscriptionDetail({ job: initialJob }: { job: JobDetail }) {
  const router = useRouter();
  const [job, setJob] = useState(initialJob);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [qualityScore, setQualityScore] = useState<number | null>(null);
  const [qualityWarningCount, setQualityWarningCount] = useState(0);
  const isCancelled = job.status === "FAILED" && job.errorMsg === CANCELLED_ERROR_MSG;

  // Polling fallback (5 s interval, stops automatically on terminal state)
  const { data: pollData } = useJobPolling<JobDetail>({
    fetchFn: async () => {
      const res = await fetch(`/api/transcription/${job.id}`, { signal: AbortSignal.timeout(10_000) });
      // Envoi annulé ou échoué : la ligne a été supprimée. État terminal, le
      // polling s'arrête (sinon il tournait indéfiniment sur un 404).
      if (res.status === 404) {
        return { ...job, status: "FAILED", errorMsg: "Cette transcription n'existe plus : l'envoi du fichier a été annulé." };
      }
      if (!res.ok) throw new Error(`Erreur ${res.status}`);
      return (await res.json()) as JobDetail;
    },
    isTerminal: (d) => d.status === "COMPLETED" || d.status === "FAILED",
    intervalMs: 5000,
    enabled: job.status !== "COMPLETED" && job.status !== "FAILED",
  });
  useEffect(() => {
    if (pollData) setJob(pollData);
  }, [pollData]);

  // SSE fast path — immediate update when webhook fires
  const jobEvent = useJobEvent(job.id);
  useEffect(() => {
    if (!jobEvent || jobEvent.jobType !== "transcription") return;
    setJob((prev) => ({
      ...prev,
      status: jobEvent.status as JobDetail["status"],
      ...(typeof jobEvent.segmentCount === "number" ? { segmentCount: jobEvent.segmentCount } : {}),
      ...(typeof jobEvent.duration === "number" ? { duration: jobEvent.duration } : {}),
      ...(typeof jobEvent.hasDiarization === "boolean" ? { hasDiarization: jobEvent.hasDiarization } : {}),
    }));
  }, [jobEvent]);

  // Fetch QA audit once job is completed
  useEffect(() => {
    if (job.status !== "COMPLETED" || !job.hasOutput) return;
    fetch(`/api/transcription/${job.id}/audit`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { score: number; warnings: { severity: string }[] } | null) => {
        if (data) {
          setQualityScore(data.score);
          setQualityWarningCount(data.warnings.length);
        }
      })
      .catch(() => {});
  }, [job.status, job.hasOutput, job.id]);

  const download = useCallback(async (format: "srt" | "json" | "chunks") => {
    setDownloading(format);
    try {
      await downloadFromApi(
        `/api/transcription/${job.id}/download?format=${format}`,
        `transcription.${format === "chunks" ? "zip" : format}`,
      );
    } catch (err) {
      toast.error(`Téléchargement impossible : ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDownloading(null);
    }
  }, [job.id]);

  const relaunchWithDiarization = useCallback(async () => {
    router.push("/transcriptions");
  }, [router]);

  const handleUseInCaptions = useCallback(() => {
    router.push(`/captions?transcriptionId=${job.id}`);
  }, [job.id, router]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {/* Back */}
      <button
        type="button"
        onClick={() => router.push("/transcriptions")}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="w-4 h-4" />
        Retour
      </button>

      {/* Header */}
      <div className="bg-white border border-border rounded-2xl p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-info-50 rounded-xl flex items-center justify-center shrink-0">
            <Mic2 className="w-5 h-5 text-info-700" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-foreground truncate">
              {job.inputFilename ?? "Transcription"}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {new Date(job.createdAt).toLocaleString("fr-FR")}
            </p>
          </div>
          {/* Status badge — une annulation volontaire n'est pas un échec. */}
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
            job.status === "COMPLETED" ? "bg-green-50 text-green-700" :
            isCancelled ? "bg-muted text-muted-foreground" :
            job.status === "FAILED"    ? "bg-red-50 text-red-700" :
            job.status === "PROCESSING" ? "bg-info-50 text-info-700" :
            "bg-muted text-muted-foreground"
          }`}>
            {job.status === "COMPLETED" && <CheckCircle className="w-3.5 h-3.5" />}
            {job.status === "FAILED" && !isCancelled && <XCircle className="w-3.5 h-3.5" />}
            {job.status === "PROCESSING" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {job.status === "QUEUED"    && <Clock className="w-3.5 h-3.5" />}
            {isCancelled ? "Annulée" : {
              COMPLETED: "Terminé", FAILED: "Échec",
              PROCESSING: "En cours…", QUEUED: "En attente",
            }[job.status]}
          </div>
        </div>

        {/* Metadata chips */}
        <div className="flex flex-wrap gap-2">
          {job.duration != null && (
            <span className="px-2.5 py-1 rounded-full bg-muted text-muted-foreground text-xs">
              ⏱ {fmtDuration(job.duration)}
            </span>
          )}
          {job.segmentCount != null && (
            <span className="px-2.5 py-1 rounded-full bg-muted text-muted-foreground text-xs">
              {job.segmentCount} segments
            </span>
          )}
          <span className="px-2.5 py-1 rounded-full bg-muted text-muted-foreground text-xs">
            {MODEL_LABELS[job.model] ?? job.model}
          </span>
          <span className={`px-2.5 py-1 rounded-full text-xs ${
            job.languages && job.languages.length >= 2
              ? "bg-info-100 text-info-700 font-semibold"
              : "bg-muted text-muted-foreground"
          }`}>
            {languageBadgeLabel(job)}
          </span>
          {job.hasDiarization && (
            <span className="px-2.5 py-1 rounded-full bg-info-50 text-info-700 text-xs">
              Intervenants identifiés
            </span>
          )}          {qualityScore !== null && (
            <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
              qualityScore >= 80 ? "bg-green-50 text-green-700" :
              qualityScore >= 60 ? "bg-warning-50 text-warning-700" :
              "bg-red-50 text-red-700"
            }`}>
              SRT {qualityScore}/100
              {qualityWarningCount > 0 && <span className="opacity-70"> · {qualityWarningCount} points</span>}
            </span>
          )}        </div>
      </div>

      {/* Vidéo pas encore lancée : rien ne se passera sans action — pas de spinner. */}
      {job.status === "QUEUED" && (
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-4 text-sm text-foreground space-y-1">
          <p className="font-semibold">
            {job.uploadedAt ? "Vidéo prête, pas encore lancée" : "Envoi du fichier en cours ou inachevé"}
          </p>
          <p className="text-muted-foreground">
            {job.uploadedAt
              ? "Lancez-la depuis la page Transcription, seule ou avec son lot."
              : "Suivez l'envoi depuis la page Transcription, dans l'onglet où il a été lancé."}
          </p>
          {job.errorMsg && <p className="text-xs text-warning-700">{job.errorMsg}</p>}
        </div>
      )}

      {job.status === "PROCESSING" && (
        <div className="flex flex-col items-center gap-4 py-12 text-muted-foreground">
          <Loader2 className="w-10 h-10 animate-spin text-info-600" />
          <div className="text-center">
            <p className="font-medium text-muted-foreground">Transcription en cours…</p>
            <p className="text-sm mt-1">Cette page se met à jour automatiquement</p>
          </div>
          <button
            type="button"
            onClick={() => { void fetch(`/api/transcription/${job.id}`).then((r) => r.json()).then((d: JobDetail) => setJob(d)); }}
            className="flex items-center gap-1.5 text-sm text-info-700 hover:underline"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Actualiser
          </button>
        </div>
      )}

      {/* Error */}
      {isCancelled && (
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-4 text-sm text-muted-foreground">
          Transcription annulée.
        </div>
      )}

      {job.status === "FAILED" && !isCancelled && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-4 text-sm text-red-700 space-y-1">
          <p className="font-semibold">La transcription a échoué</p>
          {job.errorMsg && <p className="text-xs text-red-500 font-mono">{job.errorMsg}</p>}
        </div>
      )}

      {/* Downloads — only when COMPLETED */}
      {job.status === "COMPLETED" && job.hasOutput && (
        <div className="space-y-4">
          {/* Primary CTA: Use in Captions */}
          <button
            type="button"
            onClick={handleUseInCaptions}
            className="w-full flex items-center justify-between gap-3 bg-gray-900 hover:bg-gray-700 text-white rounded-xl px-5 py-4 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Scissors className="w-5 h-5 shrink-0" />
              <div className="text-left">
                <p className="font-semibold text-sm">Utiliser dans Captions</p>
                <p className="text-info-200 text-xs">Découper les segments et générer des sous-titres vidéo</p>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 shrink-0" />
          </button>

          {/* Primary download: SRT */}
          <button
            type="button"
            onClick={() => void download("srt")}
            disabled={downloading === "srt"}
            className="w-full flex items-center justify-between gap-3 bg-gray-900 hover:bg-gray-700 disabled:opacity-60 text-white
              rounded-xl px-5 py-4 transition-colors"
          >
            <div className="flex items-center gap-3">
              <FileText className="w-5 h-5 shrink-0" />
              <div className="text-left">
                <p className="font-semibold text-sm">Télécharger le SRT</p>
                <p className="text-info-200 text-xs">Sous-titres prêts pour l&apos;éditeur captions</p>
              </div>
            </div>
            {downloading === "srt"
              ? <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              : <Download className="w-4 h-4 shrink-0" />
            }
          </button>

          {/* Relancer avec diarisation */}
          {!job.hasDiarization && job.enableDiarization === false && (
            <button
              type="button"
              onClick={() => void relaunchWithDiarization()}
              className="w-full flex items-center justify-center gap-2 border border-info-200 text-info-700
                hover:bg-info-50 rounded-xl px-5 py-3 text-sm transition-colors"
            >
              <Mic2 className="w-4 h-4" />
              Relancer avec identification des intervenants
            </button>
          )}

          {/* Advanced section */}
          <div className="border border-border rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              className="w-full flex items-center justify-between px-5 py-3.5 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              <span>Outils avancés</span>
              <span className="text-muted-foreground text-xs">{advancedOpen ? "▲" : "▼"}</span>
            </button>

            {advancedOpen && (
              <div className="border-t border-border divide-y divide-gray-50">
                {/* JSON brut */}
                <button
                  type="button"
                  onClick={() => void download("json")}
                  disabled={downloading === "json"}
                  className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-muted disabled:opacity-60 transition-colors"
                >
                  <FileJson className="w-5 h-5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">JSON brut</p>
                    <p className="text-xs text-muted-foreground">
                      Segments complets avec timestamps
                      {job.hasDiarization ? " et speakers" : ""}
                    </p>
                  </div>
                  {downloading === "json"
                    ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />
                    : <Download className="w-4 h-4 text-muted-foreground shrink-0" />
                  }
                </button>

                {/* Chunks IA */}
                <button
                  type="button"
                  onClick={() => void download("chunks")}
                  disabled={downloading === "chunks"}
                  className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-muted disabled:opacity-60 transition-colors"
                >
                  <Layers className="w-5 h-5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">Chunks IA <span className="text-xs text-muted-foreground font-normal">(ZIP)</span></p>
                    <p className="text-xs text-muted-foreground">
                      Découpage ~9 000 tokens pour ChatGPT / Claude — détection backstage incluse
                    </p>
                  </div>
                  {downloading === "chunks"
                    ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />
                    : <Download className="w-4 h-4 text-muted-foreground shrink-0" />
                  }
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
