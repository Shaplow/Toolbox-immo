"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Download,
  RotateCw,
  Sparkles,
} from "lucide-react";
import { getRenderStageLabel } from "@/lib/renderer/renderWorkflow";
import { useJobPolling } from "@/lib/hooks/useJobPolling";
import type { JobEventPayload } from "@/lib/sseStore";
import { toast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";

type RenderStatus = "PENDING" | "PROCESSING" | "DONE" | "ERROR";

interface RenderData {
  status: RenderStatus;
  pngUrl?: string | null;
  videoUrl?: string | null;
  errorMsg?: string | null;
  stage?: string | null;
  statusDetail?: string | null;
  progress?: number | null;
}

interface Props {
  renderId: string;
  initialStatus: string;
  pngUrl: string | null;
  videoUrl?: string | null;
  errorMsg: string | null;
  templateId: string;
  listingId: string;
  stage?: string | null;
  statusDetail?: string | null;
  progress?: number | null;
  coverAutoEnabled?: boolean;
  hasCovers?: boolean;
}

export function RenderResult({ renderId, initialStatus, pngUrl: initPng, videoUrl: initVideo, errorMsg: initErr, templateId, listingId, stage: initStage, statusDetail: initDetail, progress: initProgress, coverAutoEnabled = false, hasCovers = false }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<RenderStatus>(initialStatus as RenderStatus);
  const [pngUrl, setPngUrl] = useState(initPng);
  const [videoUrl, setVideoUrl] = useState(initVideo ?? null);
  const [errorMsg, setErrorMsg] = useState(initErr);
  const [stage, setStage] = useState(initStage ?? null);
  const [statusDetail, setStatusDetail] = useState(initDetail ?? null);
  const [progress, setProgress] = useState<number | null>(initProgress ?? null);
  const [coverBusy, setCoverBusy] = useState(false);

  const isTerminal = useCallback((s: RenderStatus) => s === "DONE" || s === "ERROR", []);

  const apply = useCallback((data: RenderData) => {
    setStatus(data.status);
    if (data.pngUrl) setPngUrl(data.pngUrl);
    if (data.videoUrl) setVideoUrl(data.videoUrl);
    if (data.errorMsg) setErrorMsg(data.errorMsg);
    setStage(data.stage ?? null);
    setStatusDetail(data.statusDetail ?? null);
    setProgress(typeof data.progress === "number" ? data.progress : null);
  }, []);

  // ─── Periodic poll ───────────────────────────────────────────────────────
  const { data: polled } = useJobPolling<RenderData>({
    fetchFn: useCallback(() => fetch(`/api/renders/${renderId}`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.json()), [renderId]),
    isTerminal: useCallback((d: RenderData) => d.status === "DONE" || d.status === "ERROR", []),
    intervalMs: 2000,
    enabled: status === "PENDING" || status === "PROCESSING",
  });

  useEffect(() => {
    if (polled) apply(polled);
  }, [polled, apply]);

  // ─── SSE — stop polling immediately when webhook fires ───────────────────
  useEffect(() => {
    if (isTerminal(status)) return;
    const source = new EventSource("/api/events/jobs");
    source.addEventListener("job", (e) => {
      try {
        const event = JSON.parse(e.data) as JobEventPayload;
        if (event.jobType === "render" && event.jobId === renderId) {
          setStatus(event.status as RenderStatus);
          if ("videoUrl" in event && event.videoUrl) setVideoUrl(event.videoUrl as string);
          if ("errorMsg" in event && event.errorMsg) setErrorMsg(event.errorMsg as string);
          source.close();
        }
      } catch { /* ignore parse errors */ }
    });
    return () => source.close();
  }, [renderId, status, isTerminal]);

  const generateCover = useCallback(async () => {
    setCoverBusy(true);
    try {
      const res = await fetch(`/api/renders/${renderId}/cover`, { method: "POST" });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Erreur génération cover");
      toast.success("Tirage cover prêt.");
      router.push("/tools/cover");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur génération cover");
    } finally {
      setCoverBusy(false);
    }
  }, [renderId, router]);

  // ── Données dérivées pour le téléchargement ──────────────────────────────
  const downloadUrl = videoUrl ?? pngUrl ?? null;
  const downloadExt = videoUrl ? "MP4" : pngUrl ? "PNG" : null;
  // Filtre les WARNINGS: du errorMsg côté status DONE (cas particulier).
  const isWarningPayload =
    status === "DONE" && !!errorMsg && errorMsg.startsWith("WARNINGS:");
  const warningList = isWarningPayload
    ? (() => {
        try {
          return JSON.parse(errorMsg!.slice("WARNINGS:".length)) as string[];
        } catch {
          return null;
        }
      })()
    : null;

  return (
    <div className="space-y-5">
      {/* Status badge — glass v2 par tonalité */}
      <div>
        <StatusPill status={status} />
      </div>

      {/* Error message — carte glass rose */}
      {status === "ERROR" && errorMsg && !isWarningPayload && (
        <div className="rounded-2xl bg-gradient-to-b from-danger-50/85 to-danger-50/55  px-4 py-3">
          <p className="text-[13px] text-danger-700">{errorMsg}</p>
        </div>
      )}

      {/* Progression — carte glass peach quand encore en cours */}
      {(stage || statusDetail || typeof progress === "number") && status !== "DONE" && (
        <div className="rounded-2xl bg-card border border-border  px-4 py-3 space-y-2">
          {stage && (
            <p className="text-[12.5px] font-medium text-gray-800">
              Étape : {getRenderStageLabel(stage)}
            </p>
          )}
          {statusDetail && <p className="text-[12px] text-muted-foreground">{statusDetail}</p>}
          {typeof progress === "number" && (
            <div className="space-y-1">
              <div className="w-full bg-white/60 rounded-full h-1.5 overflow-hidden shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06)]">
                <div
                  className="bg-gradient-to-r from-warning-200 to-warning-600 h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${Math.max(3, Math.round(progress * 100))}%` }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground tabular-nums">
                {Math.round(progress * 100)}%
              </p>
            </div>
          )}
        </div>
      )}

      {/* Avertissements résolution (DONE + WARNINGS:) */}
      {warningList && (
        <div className="rounded-2xl bg-gradient-to-b from-info-50/85 to-info-50/55  px-4 py-3">
          <p className="text-[12.5px] font-medium text-info-700 mb-1.5">
            Avertissements résolution
          </p>
          <ul className="list-disc list-inside space-y-0.5">
            {warningList.map((w) => (
              <li key={w} className="text-[11.5px] text-info-700/90">
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Preview — carte glass, media contenu à max-h-[60vh] pour rentrer
          dans l'écran avec le footer actions visible */}
      {status === "DONE" && (videoUrl || pngUrl) && (
        <div className="rounded-2xl bg-gradient-to-b from-gray-50/80 to-gray-100/60  overflow-hidden">
          <div className="flex items-center justify-center min-h-[35vh] max-h-[60vh] p-3">
            {videoUrl ? (
              <video
                src={videoUrl}
                controls
                playsInline
                className="block max-h-[55vh] max-w-full w-auto h-auto rounded-xl"
              />
            ) : pngUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={pngUrl}
                alt="Aperçu du visuel"
                className="block max-h-[55vh] max-w-full w-auto h-auto object-contain rounded-xl"
              />
            ) : null}
          </div>
        </div>
      )}

      {/* Actions principales — Régénérer + Télécharger (DONE) */}
      {status === "DONE" && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {templateId && (
            <Button
              variant="secondary"
              size="md"
              icon={RotateCw}
              onClick={() =>
                router.push(`/generate/${templateId}?listingId=${listingId}`)
              }
            >
              Régénérer
            </Button>
          )}
          {downloadUrl && downloadExt && (
            <a
              href={downloadUrl}
              download
              className="inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-md text-[13px] font-medium bg-gradient-to-b from-gray-700 to-gray-900 text-white  hover:from-gray-600 hover:to-gray-800 transition-all focus-ring"
            >
              <Download size={14} />
              Télécharger {downloadExt}
            </a>
          )}
          {videoUrl && coverAutoEnabled && hasCovers && (
            <Button
              variant="ghost"
              size="md"
              icon={Sparkles}
              loading={coverBusy}
              onClick={() => void generateCover()}
            >
              Générer une cover
            </Button>
          )}
        </div>
      )}

      {/* Liens secondaires — back + nouveau visuel from scratch */}
      <div className="flex items-center gap-4 pt-3 border-t border-white/40 text-[12px]">
        <Link
          href="/listings"
          className="text-muted-foreground hover:text-gray-900 transition-colors font-medium"
        >
          ← Mes générations
        </Link>
        {templateId && (
          <Link
            href={`/generate/${templateId}`}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Nouveau visuel (vide)
          </Link>
        )}
      </div>
    </div>
  );
}

// ── Status pill (glass v2 par tonalité) ──────────────────────────────────────
function StatusPill({ status }: { status: RenderStatus }) {
  const isProcessing = status === "PENDING" || status === "PROCESSING";
  const isDone = status === "DONE";
  const isError = status === "ERROR";
  const label =
    status === "PENDING" ? "En attente"
    : status === "PROCESSING" ? "Génération en cours"
    : status === "DONE" ? "Terminé"
    : "Erreur";
  const Icon = isProcessing ? Loader2 : isDone ? CheckCircle2 : isError ? AlertCircle : Clock;
  const cls = isProcessing
    ? "bg-warning-50/70 text-warning-700 shadow-[inset_0_0_0_1px_rgba(221,140,90,0.22)]"
    : isDone
      ? "bg-success-50/70 text-success-700 shadow-[inset_0_0_0_1px_rgba(111,162,128,0.22)]"
      : "bg-danger-50/70 text-danger-700 shadow-[inset_0_0_0_1px_rgba(201,113,133,0.28)]";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium ${cls}`}>
      <Icon size={12} className={isProcessing ? "animate-spin" : ""} />
      {label}
    </span>
  );
}
