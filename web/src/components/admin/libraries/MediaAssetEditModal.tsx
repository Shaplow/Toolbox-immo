"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Scissors, X, AlertTriangle, Loader2, CheckCircle2,
  Volume2, SlidersHorizontal, Play, ChevronLeft, ChevronRight, VolumeX,
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
  const [gainDb, setGainDb] = useState(0);

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
    if (!vid || !isFinite(vid.duration) || vid.duration === 0) return;
    const d = vid.duration;
    setDuration(d);
    // Always sync trimEnd to the actual video duration. The DB value may be stale
    // (probe failed on upload, or file was trimmed externally). Only skip if the
    // user has already dragged the scrubber below the real duration.
    if (trimEndRef.current === 0 || trimEndRef.current >= d) applyEnd(d, false);
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
      ...(gainDb !== 0 && { gainDb }),
    };

    try {
      const res  = await fetch(`/api/admin/libraries/media/assets/${asset.id}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      const data = await res.json() as { jobId?: string; error?: string };

      if (res.status === 409) {
        // Another job is already running for this asset — switch to monitoring it.
        setJobStatus("processing");
        pollRef.current = setTimeout(() => { void pollJobStatusRef.current?.(); }, POLL_INTERVAL_MS);
        return;
      }
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
  const hasOps      = trimChanged || mixToMono || normalize || gainDb !== 0;
  const busy        = jobStatus === "submitting" || jobStatus === "processing";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-danger-100 rounded-lg flex items-center justify-center shrink-0">
              <Scissors size={15} className="text-danger-700" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Éditer le rush</h2>
              <p className="text-[11px] text-muted-foreground truncate max-w-[380px]">{asset.filename}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-muted-foreground rounded-full hover:bg-muted transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto">
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
              <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide flex items-center gap-1.5">
                <SlidersHorizontal size={12} className="text-muted-foreground" />
                Découpe
              </h3>
              {duration > 0 && (
                <button
                  type="button"
                  onClick={previewSelection}
                  disabled={busy}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-danger-200 bg-danger-50 text-danger-700 text-[11px] font-medium hover:bg-danger-100 transition-colors disabled:opacity-40"
                >
                  <Play size={10} className="fill-violet-700" />
                  Prévisualiser la sélection
                </button>
              )}
            </div>

            {duration === 0 ? (
              <p className="text-xs text-muted-foreground italic">Chargement de la vidéo…</p>
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
                  <div className="absolute inset-x-0 h-2 bg-gray-200 rounded-full" />
                  <div
                    className="absolute h-2 bg-gray-400/25 rounded-l-full pointer-events-none"
                    style={{ left: 0, width: `${startPct}%` }}
                  />
                  <div
                    className="absolute h-2 bg-gray-400/25 rounded-r-full pointer-events-none"
                    style={{ left: `${endPct}%`, right: 0 }}
                  />
                  <div
                    className="absolute h-2 bg-danger-200 rounded-full pointer-events-none"
                    style={{ left: `${startPct}%`, right: `${100 - endPct}%` }}
                  />
                  <div
                    className="absolute w-5 h-5 bg-danger-600 rounded-full border-2 border-white shadow-lg pointer-events-none ring-2 ring-danger-200"
                    style={{ left: `calc(${startPct}% - 10px)` }}
                  />
                  <div
                    className="absolute w-5 h-5 bg-danger-600 rounded-full border-2 border-white shadow-lg pointer-events-none ring-2 ring-danger-200"
                    style={{ left: `calc(${endPct}% - 10px)` }}
                  />
                </div>

                {/* Inputs with ±frame nudge */}
                <div className="flex items-end gap-2">
                  {/* Start */}
                  <div className="flex-1">
                    <label className="text-[10px] font-medium text-muted-foreground mb-1 block">Début</label>
                    <div className="flex items-center gap-1">
                      <button type="button" title="-1 frame (≈0.04 s)" onClick={() => nudgeStart(-1)}
                        className="flex-none p-1 rounded border border-border text-muted-foreground hover:bg-muted transition-colors">
                        <ChevronLeft size={12} />
                      </button>
                      <input
                        type="number" min={0} max={trimEnd - frameDur} step={0.01} value={startInput}
                        onChange={(e) => setStartInput(e.target.value)}
                        onBlur={(e) => commitStart(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && commitStart((e.target as HTMLInputElement).value)}
                        className="flex-1 min-w-0 border border-border rounded-lg px-2 py-1.5 text-xs text-center focus:outline-none focus:ring-2 focus:ring-danger-200"
                      />
                      <button type="button" title="+1 frame (≈0.04 s)" onClick={() => nudgeStart(1)}
                        className="flex-none p-1 rounded border border-border text-muted-foreground hover:bg-muted transition-colors">
                        <ChevronRight size={12} />
                      </button>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5 text-center font-mono">{fmt(trimStart)}</p>
                  </div>

                  <div className="text-muted-foreground/60 pb-5 text-sm">→</div>

                  {/* End */}
                  <div className="flex-1">
                    <label className="text-[10px] font-medium text-muted-foreground mb-1 block">Fin</label>
                    <div className="flex items-center gap-1">
                      <button type="button" title="-1 frame (≈0.04 s)" onClick={() => nudgeEnd(-1)}
                        className="flex-none p-1 rounded border border-border text-muted-foreground hover:bg-muted transition-colors">
                        <ChevronLeft size={12} />
                      </button>
                      <input
                        type="number" min={trimStart + frameDur} max={duration} step={0.01} value={endInput}
                        onChange={(e) => setEndInput(e.target.value)}
                        onBlur={(e) => commitEnd(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && commitEnd((e.target as HTMLInputElement).value)}
                        className="flex-1 min-w-0 border border-border rounded-lg px-2 py-1.5 text-xs text-center focus:outline-none focus:ring-2 focus:ring-danger-200"
                      />
                      <button type="button" title="+1 frame (≈0.04 s)" onClick={() => nudgeEnd(1)}
                        className="flex-none p-1 rounded border border-border text-muted-foreground hover:bg-muted transition-colors">
                        <ChevronRight size={12} />
                      </button>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5 text-center font-mono">{fmt(trimEnd)}</p>
                  </div>

                  {/* Duration (readonly) */}
                  <div className="flex-1">
                    <label className="text-[10px] font-medium text-muted-foreground mb-1 block">Durée</label>
                    <div className="border border-border bg-info-50 rounded-lg px-2 py-1.5 text-xs text-info-700 font-semibold text-center">
                      {fmt(Math.max(0, trimEnd - trimStart))}
                    </div>
                    <p className="text-[10px] mt-0.5">&nbsp;</p>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Audio section */}
          <div className="space-y-4">
            <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide flex items-center gap-1.5">
              <Volume2 size={12} className="text-muted-foreground" /> Audio
            </h3>

            {/* Gain */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm text-foreground font-medium">Volume</label>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setGainDb(0)}
                    disabled={gainDb === 0}
                    className="text-[10px] text-muted-foreground hover:text-muted-foreground disabled:opacity-30 transition-colors"
                  >
                    reset
                  </button>
                  <span className={`text-sm font-semibold tabular-nums w-16 text-right ${
                    gainDb > 0 ? "text-green-600" : gainDb < 0 ? "text-red-500" : "text-muted-foreground"
                  }`}>
                    {gainDb > 0 ? `+${gainDb}` : gainDb}&nbsp;dB
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <VolumeX size={13} className="text-muted-foreground/60 shrink-0" />
                <input
                  type="range"
                  min={-24}
                  max={24}
                  step={1}
                  value={gainDb}
                  onChange={(e) => setGainDb(Number(e.target.value))}
                  className="flex-1 accent-violet-600 cursor-pointer"
                />
                <Volume2 size={13} className="text-muted-foreground shrink-0" />
              </div>
              {/* Quick presets */}
              <div className="flex flex-wrap gap-1.5">
                {[-12, -6, -3, 0, 3, 6, 12].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setGainDb(v)}
                    className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${
                      gainDb === v
                        ? "bg-gray-900 text-white border-gray-900"
                        : "bg-white text-muted-foreground border-border hover:border-danger-200 hover:bg-danger-50"
                    }`}
                  >
                    {v > 0 ? `+${v}` : v}&nbsp;dB
                  </button>
                ))}
              </div>
            </div>

            {/* Mix to mono + Normalize */}
            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-start gap-2.5 cursor-pointer select-none p-3 rounded-xl border border-border hover:border-danger-200 hover:bg-danger-50/40 transition-colors">
                <input
                  type="checkbox"
                  checked={mixToMono}
                  onChange={(e) => setMixToMono(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-border text-danger-700 focus:ring-danger-200"
                />
                <div>
                  <p className="text-sm font-medium text-foreground leading-tight">Mix mono</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">Fusionne L+R — utile si le micro est sur un seul canal.</p>
                </div>
              </label>
              <label className="flex items-start gap-2.5 cursor-pointer select-none p-3 rounded-xl border border-border hover:border-danger-200 hover:bg-danger-50/40 transition-colors">
                <input
                  type="checkbox"
                  checked={normalize}
                  onChange={(e) => setNormalize(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-border text-danger-700 focus:ring-danger-200"
                />
                <div>
                  <p className="text-sm font-medium text-foreground leading-tight">Normaliser</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">loudnorm EBU R128 — I = −16 LUFS.</p>
                </div>
              </label>
            </div>
          </div>

          {/* Destructive warning */}
          <div className="flex items-start gap-2 p-3 bg-warning-50 border border-warning-200 rounded-xl">
            <AlertTriangle size={14} className="text-warning-700 shrink-0 mt-0.5" />
            <p className="text-xs text-warning-700">
              Cette opération est <strong>irréversible</strong>. Le fichier original sera écrasé.
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
        <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-border shrink-0">
          {/* Operation summary */}
          <div className="flex flex-wrap gap-1">
            {trimChanged && (
              <span className="px-2 py-0.5 rounded-full text-[10px] bg-danger-100 text-danger-700 border border-danger-200">
                Découpe {fmt(trimStart)} → {fmt(trimEnd)}
              </span>
            )}
            {gainDb !== 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] bg-danger-100 text-danger-700 border border-danger-200">
                Volume {gainDb > 0 ? `+${gainDb}` : gainDb}&nbsp;dB
              </span>
            )}
            {mixToMono && (
              <span className="px-2 py-0.5 rounded-full text-[10px] bg-danger-100 text-danger-700 border border-danger-200">Mix mono</span>
            )}
            {normalize && (
              <span className="px-2 py-0.5 rounded-full text-[10px] bg-danger-100 text-danger-700 border border-danger-200">Normalisation</span>
            )}
            {!hasOps && (
              <span className="text-[11px] text-muted-foreground italic">Aucune opération sélectionnée</span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-muted-foreground border border-border rounded-lg hover:bg-muted transition-colors"
            >
              {jobStatus === "done" ? "Fermer" : "Annuler"}
            </button>

            {jobStatus !== "done" && (
              <button
                onClick={() => { void handleSubmit(); }}
                disabled={!hasOps || busy}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
    </div>
  );
}
