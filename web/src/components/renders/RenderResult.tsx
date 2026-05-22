"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getRenderStageLabel } from "@/lib/renderer/renderWorkflow";
import { useJobPolling } from "@/lib/hooks/useJobPolling";
import type { JobEventPayload } from "@/lib/sseStore";
import { toast } from "@/components/ui/Toast";

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

export function RenderResult({ renderId, initialStatus, pngUrl: initPng, videoUrl: initVideo, errorMsg: initErr, templateId, stage: initStage, statusDetail: initDetail, progress: initProgress, coverAutoEnabled = false, hasCovers = false }: Props) {
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
    fetchFn: useCallback(() => fetch(`/api/renders/${renderId}`).then((r) => r.json()), [renderId]),
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

  return (
    <div className="space-y-6">
      {/* Status badge */}
      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${
        status === "DONE"       ? "bg-green-50 text-green-700" :
        status === "ERROR"      ? "bg-red-50 text-red-700" :
        /* PENDING/PROCESSING */  "bg-indigo-50 text-indigo-700"
      }`}>
        {status === "PENDING"    && <><Spinner /> En attente…</>}
        {status === "PROCESSING" && <><Spinner /> Génération en cours…</>}
        {status === "DONE"       && <>✓ Terminé</>}
        {status === "ERROR"      && <>✕ Erreur</>}
      </div>

      {/* Error message */}
      {status === "ERROR" && errorMsg && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl p-4">{errorMsg}</p>
      )}

      {(stage || statusDetail || typeof progress === "number") && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2">
          {stage && <p className="text-sm font-medium text-gray-800">Étape: {getRenderStageLabel(stage)}</p>}
          {statusDetail && <p className="text-sm text-gray-600">{statusDetail}</p>}
          {typeof progress === "number" && status !== "DONE" && (
            <div className="space-y-1">
              <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                <div className="bg-indigo-500 h-1.5 rounded-full transition-all duration-500" style={{ width: `${Math.max(3, Math.round(progress * 100))}%` }} />
              </div>
              <p className="text-xs text-gray-500">{Math.round(progress * 100)}%</p>
            </div>
          )}
        </div>
      )}

      {/* Resolution warnings */}
      {status === "DONE" && errorMsg?.startsWith("WARNINGS:") && (() => {
        try {
          const warnList = JSON.parse(errorMsg.slice("WARNINGS:".length)) as string[];
          return (
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
              <p className="text-sm font-medium text-indigo-700 mb-2">⚠ Avertissements résolution :</p>
              <ul className="list-disc list-inside space-y-1">
                {warnList.map((w) => <li key={w} className="text-xs text-indigo-700">{w}</li>)}
              </ul>
            </div>
          );
        } catch { return null; }
      })()}

      {/* Preview + downloads — image */}
      {status === "DONE" && pngUrl && (
        <div className="space-y-4">
          {/* Preview */}
          <div className="bg-gray-100 rounded-xl overflow-hidden border border-gray-200">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pngUrl} alt="Aperçu du visuel" className="w-full h-auto" />
          </div>

          {/* Downloads */}
          <div className="flex gap-3">
            <a
              href={pngUrl}
              download
              className="flex-1 text-center py-2.5 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors"
            >
              ↓ Télécharger PNG
            </a>
          </div>
        </div>
      )}

      {/* Preview + download — vidéo */}
      {status === "DONE" && videoUrl && (
        <div className="space-y-4">
          <div className="bg-black rounded-xl overflow-hidden border border-gray-200">
            <video src={videoUrl} controls className="w-full h-auto" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <a
              href={videoUrl}
              download
              className="block w-full text-center py-2.5 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors"
            >
              ↓ Télécharger MP4
            </a>
            {coverAutoEnabled && hasCovers && (
              <button
                type="button"
                onClick={() => void generateCover()}
                disabled={coverBusy}
                className="block w-full text-center py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
              >
                {coverBusy ? "Préparation…" : "Générer une cover"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2 border-t border-gray-100">
        <Link
          href="/listings"
          className="text-sm text-gray-600 hover:text-gray-900 transition-colors font-medium"
        >
          ← Mes générations
        </Link>
        {templateId && (
          <Link
            href={`/generate/${templateId}`}
            className="text-sm text-gray-400 hover:text-gray-700 transition-colors"
          >
            Nouveau visuel
          </Link>
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}
