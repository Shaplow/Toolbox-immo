"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Scissors, X, AlertTriangle, Loader2, CheckCircle2,
  Volume2, SlidersHorizontal, Play, ChevronLeft, ChevronRight,
} from "lucide-react";
import type { MediaEditParams, MediaEditJob } from "@/types/mediaEdit";

interface MediaAsset {
  id: string;
  filename: string;
  url: string;
  duration: number | null;
}

interface Props {
  asset: MediaAsset;
  onClose: () => void;
  onDone: (assetId: string) => void;
}

/** Format seconds as M:SS.cc (centiseconds) or H:MM:SS.cc */
function fmt(s: number): string {
  const abs = Math.abs(s);
  const h   = Math.floor(abs / 3600);
  const m   = Math.floor((abs % 3600) / 60);
  const sec = Math.floor(abs % 60);
  const cs  = Math.round((abs % 1) * 100).toString().padStart(2, "0");
  const base = h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
  return `${base}.${cs}`;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}

const POLL_INTERVAL_MS  = 3000;
const DEFAULT_FRAME_DUR = 1 / 25; // fallback: 25 fps

export function MediaAssetEditModal({ asset, onClose, onDone }: Props) {
  // ── Duration ───────────────────────────────────────────────────────────────
  const [duration, setDuration] = useState(asset.duration ?? 0);
  // Frame duration — 1/25 s (25 fps fallback; no browser API to read real fps)
  

  // ── Trim state ────────────────────────────────────────────────────────────
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd,   setTrimEnd]   = useState(asset.duration ?? 0);

  // Local string states for numeric inputs — avoids toFixed() overwriting while typing
  const [startInput, setStartInput] = useState("0.00");
  const [endInput,   setEndInput]   = useState((asset.duration ?? 0).toFixed(2));

  // ── Audio ──────────────────────────────────────────────────────────────────
  const [mixToMono, setMixToMono] = useState(false);
  const [normalize, setNormalize] = useState(false);

  // ── Job ────────────────────────────────────────────────────────────────────
  const [jobStatus, setJobStatus] = useState<"idle" | "submitting" | "processing" | "done" | "failed">("idle");
  const [jobError,  setJobError]  = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Video refs ────────────────────────────────────────────────────────────
  const videoRef      = useRef<HTMLVideoElement>(null);
  const trimStartRef  = useRef(0);
  const trimEndRef    = useRef(0);
  const isPreviewRef  = useRef(false); // true only while preview-play is running

  useEffect(() => { trimStartRef.current = trimStart; }, [trimStart]);
  useEffect(() => { trimEndRef.current   = trimEnd;   }, [trimEnd]);

  // ── Helpers: update trim value + input string together ───────────────────
  const applyStart = useCallback((v: number, seek = true) => {
    const c = round2(v);
    setTrimStart(c);
    setStartInput(c.toFixed(2));
    if (seek && videoRef.current) videoRef.current.currentTime = c;
  }, []);

  const applyEnd = useCallback((v: number, seek = true) => {
    const c = round2(v);
    setTrimEnd(c);
    setEndInput(c.toFixed(2));
    if (seek && videoRef.current) videoRef.current.currentTime = c;
  }, []);

  // ── Video metadata ────────────────────────────────────────────────────────
  const handleLoadedMetadata = useCallback(() => {
    const vid = videoRef.current;
    if (!vid || !isFinite(vid.duration)) return;
    const d = vid.duration;
    setDuration(d);
    if (trimEndRef.current === 0) applyEnd(d, false);
  }, [applyEnd]);

  // ── Playback clamping — only active during preview ────────────────────────
  const handleTimeUpdate = useCallback(() => {
    if (!isPreviewRef.current) return;
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.currentTime >= trimEndRef.current) {
      vid.pause();
      vid.currentTime = trimEndRef.current;
    }
  }, []);

  const handlePause = useCallback(() => { isPreviewRef.current = false; }, []);

  // ── Preview selection ─────────────────────────────────────────────────────
  const previewSelection = useCallback(() => {
    const vid = videoRef.current;
    if (!vid) return;
    isPreviewRef.current = true;
    vid.currentTime = trimStartRef.current;
    void vid.play();
  }, []);

  // ── Polling ───────────────────────────────────────────────────────────────
  const pollJobStatusRef = useRef<(() => Promise<void>) | undefined>(undefined);

  const pollJobStatus = useCallback(async () => {
    try {
      const res  = await fetch(`/api/admin/libraries/media/assets/${asset.id}/edit`);
      if (!res.ok) return;
      const data = await res.json() as { job: MediaEditJob | null };
      if (!data.job) return;

      if (data.job.status === "done") {
        setJobStatus("done");
        onDone(asset.id);
      } else if (data.job.status === "failed") {
        setJobStatus("failed");
        setJobError(data.job.errorMsg ?? "Le traitement a échoué");
      } else {
        pollRef.current = setTimeout(() => { void pollJobStatusRef.current?.(); }, POLL_INTERVAL_MS);
      }
    } catch {
      pollRef.current = setTimeout(() => { void pollJobStatusRef.current?.(); }, POLL_INTERVAL_MS);
    }
  }, [asset.id, onDone]);

  useEffect(() => { pollJobStatusRef.current = pollJobStatus; });
  useEffect(() => () => { if (pollRef.current) clearTimeout(pollRef.current); }, []);

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setJobStatus("submitting");
    setJobError(null);

    const params: MediaEditParams = {
      ...(trimStart > 0        && { trimStart }),
      ...(trimEnd   < duration && { trimEnd }),
      mixToMono,
      normalize,
    };

    try {
      const res  = await fetch(`/api/admin/libraries/media/assets/${asset.id}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      const data = await res.json() as { jobId?: string; error?: string };

      if (!res.ok) {
        setJobStatus("failed");
        setJobError(data.error ?? `Erreur ${res.status}`);
        return;
      }

      setJobStatus("processing");
      pollRef.current = setTimeout(() => { void pollJobStatusRef.current?.(); }, POLL_INTERVAL_MS);
    } catch (err) {
      setJobStatus("failed");
      setJobError(String(err));
    }
  };

  // ── Scrubber drag ─────────────────────────────────────────────────────────
  const trackRef    = useRef<HTMLDivElement>(null);
  const activeThumb = useRef<"start" | "end" | null>(null);

  const posFromPointer = useCallback((e: React.PointerEvent): number => {
    if (!trackRef.current || duration === 0) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    return clamp((e.clientX - rect.left) / rect.width, 0, 1) * duration;
  }, [duration]);

  const handleTrackPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    videoRef.current?.pause(); // avoid timeupdate fights during drag
    const pos = posFromPointer(e);
    const fd  = DEFAULT_FRAME_DUR;
    const dS  = Math.abs(pos - trimStartRef.current);
    const dE  = Math.abs(pos - trimEndRef.current);
    activeThumb.current = dS <= dE ? "start" : "end";
    if (activeThumb.current === "start") {
      applyStart(clamp(pos, 0, trimEndRef.current - fd));
    } else {
      applyEnd(clamp(pos, trimStartRef.current + fd, duration));
    }
  }, [applyStart, applyEnd, duration, posFromPointer]);

  const handleTrackPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!activeThumb.current) return;
    const pos = posFromPointer(e);
    const fd  = DEFAULT_FRAME_DUR;
    if (activeThumb.current === "start") {
      applyStart(clamp(pos, 0, trimEndRef.current - fd));
    } else {
      applyEnd(clamp(pos, trimStartRef.current + fd, duration));
    }
  }, [applyStart, applyEnd, duration, posFromPointer]);

  const handleTrackPointerUp = useCallback(() => { activeThumb.current = null; }, []);

  // ── Numeric input commit on blur / Enter ──────────────────────────────────
  const commitStart = useCallback((raw: string) => {
    const fd = DEFAULT_FRAME_DUR;
    applyStart(clamp(parseFloat(raw) || 0, 0, trimEndRef.current - fd));
  }, [applyStart]);

  const commitEnd = useCallback((raw: string) => {
    const fd = DEFAULT_FRAME_DUR;
    applyEnd(clamp(parseFloat(raw) || 0, trimStartRef.current + fd, duration));
  }, [applyEnd, duration]);

  // ── Frame nudge ───────────────────────────────────────────────────────────
  const nudgeStart = useCallback((dir: 1 | -1) => {
    const fd = DEFAULT_FRAME_DUR;
    applyStart(clamp(round2(trimStartRef.current + dir * fd), 0, trimEndRef.current - fd));
  }, [applyStart]);

  const nudgeEnd = useCallback((dir: 1 | -1) => {
    const fd = DEFAULT_FRAME_DUR;
    applyEnd(clamp(round2(trimEndRef.current + dir * fd), trimStartRef.current + fd, duration));
  }, [applyEnd, duration]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const frameDur    = DEFAULT_FRAME_DUR;
  const startPct    = duration > 0 ? (trimStart / duration) * 100 : 0;
  const endPct      = duration > 0 ? (trimEnd   / duration) * 100 : 100;
  const trimChanged = trimStart > 0 || trimEnd < duration;
  const hasOps      = trimChanged || mixToMono || normalize;
  const busy        = jobStatus === "submitting" || jobStatus === "processing";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-violet-100 rounded-lg flex items-center justify-center">
              <Scissors size={15} className="text-violet-600" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Éditer le rush</h2>
              <p className="text-[11px] text-gray-400 truncate max-w-[280px]">{asset.filename}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Video player */}
          <div className="rounded-xl overflow-hidden bg-black aspect-video">
            <video
              ref={videoRef}
              src={asset.url}
              controls
              className="w-full h-full object-contain"
              preload="metadata"
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={handleTimeUpdate}
              onPause={handlePause}
            />
          </div>

          {/* Trim section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                <SlidersHorizontal size={13} className="text-gray-400" />
                Découpe
              </h3>
              {duration > 0 && (
                <button
                  type="button"
                  onClick={previewSelection}
                  disabled={busy}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-violet-200 bg-violet-50 text-violet-700 text-[11px] font-medium hover:bg-violet-100 transition-colors disabled:opacity-40"
                >
                  <Play size={10} className="fill-violet-700" />
                  Prévisualiser
                </button>
              )}
            </div>

            {duration === 0 ? (
              <p className="text-xs text-gray-400 italic">Chargement de la vidéo…</p>
            ) : (
              <>
                {/* Dual-range scrubber */}
                <div
                  ref={trackRef}
                  className="relative h-8 flex items-center cursor-pointer select-none touch-none"
                  onPointerDown={handleTrackPointerDown}
                  onPointerMove={handleTrackPointerMove}
                  onPointerUp={handleTrackPointerUp}
                  onPointerLeave={handleTrackPointerUp}
                >
                  {/* Full track */}
                  <div className="absolute inset-x-0 h-2 bg-gray-200 rounded-full" />
                  {/* Masked zone before start */}
                  <div
                    className="absolute h-2 bg-gray-400/25 rounded-l-full pointer-events-none"
                    style={{ left: 0, width: `${startPct}%` }}
                  />
                  {/* Masked zone after end */}
                  <div
                    className="absolute h-2 bg-gray-400/25 rounded-r-full pointer-events-none"
                    style={{ left: `${endPct}%`, right: 0 }}
                  />
                  {/* Active range */}
                  <div
                    className="absolute h-2 bg-violet-400 rounded-full pointer-events-none"
                    style={{ left: `${startPct}%`, right: `${100 - endPct}%` }}
                  />
                  {/* Start thumb */}
                  <div
                    className="absolute w-5 h-5 bg-violet-600 rounded-full border-2 border-white shadow-lg pointer-events-none ring-2 ring-violet-200"
                    style={{ left: `calc(${startPct}% - 10px)` }}
                  />
                  {/* End thumb */}
                  <div
                    className="absolute w-5 h-5 bg-violet-600 rounded-full border-2 border-white shadow-lg pointer-events-none ring-2 ring-violet-200"
                    style={{ left: `calc(${endPct}% - 10px)` }}
                  />
                </div>

                {/* Inputs with ±frame nudge */}
                <div className="flex items-end gap-2">
                  {/* Start */}
                  <div className="flex-1">
                    <label className="text-[10px] font-medium text-gray-500 mb-1 block">Début</label>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        title="-1 frame (≈0.04 s)"
                        onClick={() => nudgeStart(-1)}
                        className="flex-none p-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-100 transition-colors"
                      >
                        <ChevronLeft size={12} />
                      </button>
                      <input
                        type="number"
                        min={0}
                        max={trimEnd - frameDur}
                        step={0.01}
                        value={startInput}
                        onChange={(e) => setStartInput(e.target.value)}
                        onBlur={(e)    => commitStart(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && commitStart((e.target as HTMLInputElement).value)}
                        className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-center focus:outline-none focus:ring-2 focus:ring-violet-300"
                      />
                      <button
                        type="button"
                        title="+1 frame (≈0.04 s)"
                        onClick={() => nudgeStart(1)}
                        className="flex-none p-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-100 transition-colors"
                      >
                        <ChevronRight size={12} />
                      </button>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-0.5 text-center font-mono">{fmt(trimStart)}</p>
                  </div>

                  <div className="text-gray-300 pb-5 text-sm">→</div>

                  {/* End */}
                  <div className="flex-1">
                    <label className="text-[10px] font-medium text-gray-500 mb-1 block">Fin</label>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        title="-1 frame (≈0.04 s)"
                        onClick={() => nudgeEnd(-1)}
                        className="flex-none p-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-100 transition-colors"
                      >
                        <ChevronLeft size={12} />
                      </button>
                      <input
                        type="number"
                        min={trimStart + frameDur}
                        max={duration}
                        step={0.01}
                        value={endInput}
                        onChange={(e) => setEndInput(e.target.value)}
                        onBlur={(e)    => commitEnd(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && commitEnd((e.target as HTMLInputElement).value)}
                        className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-center focus:outline-none focus:ring-2 focus:ring-violet-300"
                      />
                      <button
                        type="button"
                        title="+1 frame (≈0.04 s)"
                        onClick={() => nudgeEnd(1)}
                        className="flex-none p-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-100 transition-colors"
                      >
                        <ChevronRight size={12} />
                      </button>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-0.5 text-center font-mono">{fmt(trimEnd)}</p>
                  </div>

                  {/* Duration (readonly) */}
                  <div className="flex-1">
                    <label className="text-[10px] font-medium text-gray-500 mb-1 block">Durée</label>
                    <div className="border border-gray-100 bg-gray-50 rounded-lg px-2 py-1.5 text-xs text-gray-500 text-center">
                      {fmt(Math.max(0, trimEnd - trimStart))}
                    </div>
                    <p className="text-[10px] mt-0.5">&nbsp;</p>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Audio section */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
              <Volume2 size={13} className="text-gray-400" /> Audio
            </h3>
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={mixToMono}
                onChange={(e) => setMixToMono(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-violet-600 focus:ring-violet-400"
              />
              <div>
                <p className="text-sm text-gray-800">Mix to mono</p>
                <p className="text-[11px] text-gray-400">Fusionne les canaux L+R — utile si le micro était branché sur un seul canal.</p>
              </div>
            </label>
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={normalize}
                onChange={(e) => setNormalize(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-violet-600 focus:ring-violet-400"
              />
              <div>
                <p className="text-sm text-gray-800">Normaliser le volume</p>
                <p className="text-[11px] text-gray-400">loudnorm EBU R128 — I&nbsp;=&nbsp;−16&nbsp;LUFS, TP&nbsp;=&nbsp;−1.5&nbsp;dBTP.</p>
              </div>
            </label>
          </div>

          {/* Destructive warning */}
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
            <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800">
              Cette opération est <strong>irréversible</strong>. Le fichier original sera écrasé. Assurez-vous d&apos;avoir une copie si nécessaire.
            </p>
          </div>

          {/* Error */}
          {jobError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
              {jobError}
            </div>
          )}

          {/* Success */}
          {jobStatus === "done" && (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700">
              <CheckCircle2 size={15} /> Asset mis à jour avec succès.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 pb-5 pt-2 border-t border-gray-100">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-40"
          >
            {jobStatus === "done" ? "Fermer" : "Annuler"}
          </button>

          {jobStatus !== "done" && (
            <button
              onClick={() => { void handleSubmit(); }}
              disabled={!hasOps || busy}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-violet-600 text-white rounded-xl hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {busy ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  {jobStatus === "submitting" ? "Soumission…" : "Traitement…"}
                </>
              ) : (
                <>
                  <Scissors size={14} />
                  Appliquer
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
