"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Check, X, ChevronLeft, ChevronRight, Loader2, AlertTriangle, Play, Pause, RotateCcw } from "lucide-react";

export interface AutocutJob {
  id: string;
  assetId: string;
  status: string;
  reviewStatus: string;
  proposedStart: number | null;
  proposedEnd: number | null;
  confirmedStart: number | null;
  confirmedEnd: number | null;
  transcriptJson: string | null;
  language: string | null;
  errorMsg: string | null;
  createdAt: string;
  editJob: { id: string; status: string } | null;
  asset: {
    id: string;
    filename: string;
    url: string;
    duration: number | null;
  };
}

interface Props {
  job: AutocutJob;
  onAccept: (jobId: string, confirmedStart: number, confirmedEnd: number) => Promise<void>;
  onSkip: (jobId: string) => Promise<void>;
}

function fmt(s: number): string {
  const abs = Math.abs(s);
  const m = Math.floor(abs / 60);
  const sec = Math.floor(abs % 60);
  const cs = Math.round((abs % 1) * 100).toString().padStart(2, "0");
  return `${m}:${String(sec).padStart(2, "0")}.${cs}`;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}

// ── Détection de prises multiples ─────────────────────────────────────────────
type TranscriptSegment = { text: string; start: number; end: number };

interface Take {
  index: number;
  segments: TranscriptSegment[];
  start: number; // avec padding
  end: number;   // avec padding
  score: number; // 0–100
  text: string;
}

// Pause ≥ 1.5s entre deux segments = nouvelle prise
const TAKE_GAP_S = 1.5;
const TAKE_PAD_S = 0.15;
const HESITATION_RE = /\b(euh|heu|hm|donc|alors|ben|voil[aà]|enfin|bref|ouais)\b/gi;

function detectTakes(segments: TranscriptSegment[], totalDuration: number): Take[] {
  if (!segments.length) return [];

  const groups: TranscriptSegment[][] = [];
  let current: TranscriptSegment[] = [segments[0]];

  for (let i = 1; i < segments.length; i++) {
    if (segments[i].start - segments[i - 1].end >= TAKE_GAP_S) {
      groups.push(current);
      current = [segments[i]];
    } else {
      current.push(segments[i]);
    }
  }
  groups.push(current);

  return groups.map((group, idx) => {
    const rawStart = group[0].start;
    const rawEnd = group[group.length - 1].end;
    const start = Math.max(0, rawStart - TAKE_PAD_S);
    const end = Math.min(totalDuration > 0 ? totalDuration : rawEnd + 1, rawEnd + TAKE_PAD_S);
    const text = group.map((s) => s.text).join(" ").trim();
    const words = text.split(/\s+/).filter(Boolean);

    // Score 0–100 : longueur + débit + hésitations + complétude
    const lengthScore = Math.min(100, (words.length / 25) * 100);
    const dur = rawEnd - rawStart;
    const rate = dur > 0 ? words.length / dur : 0;
    const rateScore = Math.max(0, 100 - Math.abs(rate - 3) * 25);
    const hesCount = (text.match(HESITATION_RE) ?? []).length;
    const hesScore = Math.max(0, 100 - hesCount * 20);
    const completenessScore = /[.!?»"']$/.test(text) ? 100 : 55;
    const score = Math.round(
      lengthScore * 0.35 + rateScore * 0.25 + hesScore * 0.25 + completenessScore * 0.15
    );

    return { index: idx + 1, segments: group, start, end, score, text };
  });
}

// ── Lecteur vidéo contraint entre trimStart et trimEnd ────────────────────────
interface TrimPlayerProps {
  src: string;
  trimStart: number;
  trimEnd: number;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

function TrimPlayer({ src, trimStart, trimEnd, videoRef }: TrimPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(trimStart);
  const scrubBarRef = useRef<HTMLDivElement>(null);

  // Refs pour accéder aux valeurs courantes dans les event listeners sans stale closure
  const trimStartRef = useRef(trimStart);
  const trimEndRef = useRef(trimEnd);
  useEffect(() => { trimStartRef.current = trimStart; }, [trimStart]);
  useEffect(() => { trimEndRef.current = trimEnd; }, [trimEnd]);

  // Seek au nouveau trimStart quand il change
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (!isPlaying) {
      try { v.currentTime = trimStart; } catch { /* ok */ }
      setCurrentTime(trimStart);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimStart]);

  // Quand trimEnd change en cours de lecture, la contrainte sera appliquée par timeupdate

  // Montage : seek initial + attacher timeupdate
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const handleLoaded = () => {
      try { v.currentTime = trimStartRef.current; } catch { /* ok */ }
      setCurrentTime(trimStartRef.current);
    };

    const handleTimeUpdate = () => {
      const ct = v.currentTime;
      const end = trimEndRef.current;
      const start = trimStartRef.current;

      if (ct >= end) {
        v.pause();
        try { v.currentTime = end; } catch { /* ok */ }
        setIsPlaying(false);
        setCurrentTime(end);
        return;
      }
      if (ct < start) {
        try { v.currentTime = start; } catch { /* ok */ }
        return;
      }
      setCurrentTime(ct);
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => { setIsPlaying(false); setCurrentTime(trimStartRef.current); };

    if (v.readyState >= 1) handleLoaded();
    else v.addEventListener("loadedmetadata", handleLoaded, { once: true });

    v.addEventListener("timeupdate", handleTimeUpdate);
    v.addEventListener("play", handlePlay);
    v.addEventListener("pause", handlePause);
    v.addEventListener("ended", handleEnded);

    return () => {
      v.removeEventListener("timeupdate", handleTimeUpdate);
      v.removeEventListener("play", handlePlay);
      v.removeEventListener("pause", handlePause);
      v.removeEventListener("ended", handleEnded);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (isPlaying) {
      v.pause();
      return;
    }
    // Si hors plage, remettre au début
    const ct = v.currentTime;
    if (ct < trimStart || ct >= trimEnd) {
      try { v.currentTime = trimStart; } catch { /* ok */ }
    }
    void v.play();
  }, [isPlaying, trimStart, trimEnd, videoRef]);

  const seekToStart = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    try { v.currentTime = trimStart; } catch { /* ok */ }
    setCurrentTime(trimStart);
  }, [trimStart, videoRef]);

  const seekToEnd = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const t = Math.max(trimStart, trimEnd - 0.04);
    try { v.currentTime = t; } catch { /* ok */ }
    setCurrentTime(t);
  }, [trimStart, trimEnd, videoRef]);

  // Scrubber : clic ou drag pour seeker dans [trimStart, trimEnd]
  const handleScrubClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const bar = scrubBarRef.current;
    const v = videoRef.current;
    if (!bar || !v) return;
    const rect = bar.getBoundingClientRect();
    const ratio = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const target = trimStart + ratio * (trimEnd - trimStart);
    try { v.currentTime = target; } catch { /* ok */ }
    setCurrentTime(target);
  }, [trimStart, trimEnd, videoRef]);

  const trimDuration = trimEnd - trimStart;
  const progress = trimDuration > 0 ? clamp((currentTime - trimStart) / trimDuration, 0, 1) : 0;
  const relTime = clamp(currentTime - trimStart, 0, trimDuration);

  return (
    <div className="flex flex-col gap-1.5 w-64 flex-shrink-0">
      {/* Video — sans contrôles natifs */}
      <div className="relative rounded-lg overflow-hidden bg-black">
        <video
          ref={videoRef}
          src={src}
          className="w-full"
          style={{ maxHeight: "144px", display: "block" }}
          preload="metadata"
        />
      </div>

      {/* Barre de progression custom — clampée sur [trimStart, trimEnd] */}
      <div
        ref={scrubBarRef}
        onClick={handleScrubClick}
        className="relative h-2 bg-gray-200 rounded-full cursor-pointer group"
      >
        <div
          className="absolute inset-y-0 left-0 bg-indigo-500 rounded-full"
          style={{ width: `${progress * 100}%` }}
        />
        {/* Curseur */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white border-2 border-indigo-500 rounded-full shadow"
          style={{ left: `calc(${progress * 100}% - 6px)` }}
        />
      </div>

      {/* Contrôles */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={togglePlay}
          className="flex items-center justify-center w-7 h-7 rounded-full bg-indigo-600 text-white hover:bg-indigo-700 flex-shrink-0"
        >
          {isPlaying ? <Pause size={12} /> : <Play size={12} />}
        </button>
        <button
          onClick={seekToStart}
          className="flex items-center gap-1 text-xs text-gray-500 border border-gray-200 rounded px-1.5 py-0.5 hover:bg-gray-50"
          title="Aller au début du timecode"
        >
          <RotateCcw size={9} /> Début
        </button>
        <button
          onClick={seekToEnd}
          className="flex items-center gap-1 text-xs text-gray-500 border border-gray-200 rounded px-1.5 py-0.5 hover:bg-gray-50"
          title="Aller à la fin du timecode"
        >
          Fin
        </button>
        <span className="ml-auto text-xs text-gray-500 tabular-nums">
          +{fmt(relTime)} / {fmt(trimDuration)}
        </span>
      </div>
    </div>
  );
}

// ── Carte principale ──────────────────────────────────────────────────────────
export function AutocutReviewCard({ job, onAccept, onSkip }: Props) {
  const { asset } = job;
  const duration = asset.duration ?? 0;

  // Analyser le transcript pour détecter les prises avant les useState
  const { takes, transcript } = useMemo(() => {
    if (!job.transcriptJson) return { takes: [] as Take[], transcript: null };
    try {
      const segs = JSON.parse(job.transcriptJson) as TranscriptSegment[];
      return { takes: detectTakes(segs, duration), transcript: segs };
    } catch { return { takes: [] as Take[], transcript: null }; }
  }, [job.transcriptJson, duration]);
  // Meilleure prise = score le plus élevé
  const bestIdx = takes.length > 1
    ? takes.reduce((b, t, i) => t.score > takes[b].score ? i : b, 0)
    : 0;

  // Si plusieurs prises et pas encore confirmé manuellement → pré-sélectionner la meilleure
  const initStart = job.confirmedStart != null
    ? job.confirmedStart
    : takes.length > 1 ? takes[bestIdx].start : (job.proposedStart ?? 0);
  const initEnd = job.confirmedEnd != null
    ? job.confirmedEnd
    : takes.length > 1 ? takes[bestIdx].end : (job.proposedEnd ?? duration);

  const [trimStart, setTrimStart] = useState(initStart);
  const [trimEnd, setTrimEnd] = useState(initEnd);
  const [startInput, setStartInput] = useState(initStart.toFixed(2));
  const [endInput, setEndInput] = useState(initEnd.toFixed(2));
  const [saving, setSaving] = useState(false);
  const [selectedTakeIndex, setSelectedTakeIndex] = useState(takes.length > 1 ? bestIdx : 0);

  const videoRef = useRef<HTMLVideoElement>(null);

  // Texte affiché : celui de la prise sélectionnée, ou full transcript si prise unique
  const transcriptText = takes.length > 1
    ? (takes[selectedTakeIndex]?.text ?? null)
    : (transcript?.map((s) => s.text).join(" ").trim() ?? null);

  const applyStart = useCallback((v: number) => {
    const clamped = round2(clamp(v, 0, trimEnd - 0.1));
    setTrimStart(clamped);
    setStartInput(clamped.toFixed(2));
  }, [trimEnd]);

  const applyEnd = useCallback((v: number) => {
    const hi = duration > 0 ? duration : trimStart + 3600;
    const clamped = round2(clamp(v, trimStart + 0.1, hi));
    setTrimEnd(clamped);
    setEndInput(clamped.toFixed(2));
  }, [trimStart, duration]);

  const handleSelectTake = useCallback((idx: number) => {
    const take = takes[idx];
    if (!take) return;
    setSelectedTakeIndex(idx);
    // applyStart/applyEnd sont définis plus haut dans le même composant
    const newStart = round2(clamp(take.start, 0, take.end - 0.1));
    const newEnd = round2(clamp(take.end, take.start + 0.1, duration > 0 ? duration : take.end + 1));
    setTrimStart(newStart); setStartInput(newStart.toFixed(2));
    setTrimEnd(newEnd); setEndInput(newEnd.toFixed(2));
    const v = videoRef.current;
    if (v) { try { v.currentTime = newStart; } catch { /* ok */ } }
  }, [takes, duration, videoRef]);

  const handleAccept = async () => {
    setSaving(true);
    try { await onAccept(job.id, trimStart, trimEnd); }
    finally { setSaving(false); }
  };

  const handleSkip = async () => {
    setSaving(true);
    try { await onSkip(job.id); }
    finally { setSaving(false); }
  };

  if (job.reviewStatus === "applied") {
    const editStatus = job.editJob?.status ?? "pending";
    const isDone = editStatus === "done";
    const isFailed = editStatus === "failed";
    const isPending = !isDone && !isFailed;
    return (
      <div className="border border-gray-200 rounded-xl p-4 bg-white opacity-80">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-gray-700 font-medium truncate max-w-xs">{asset.filename}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full flex items-center gap-1 flex-shrink-0 ${isDone ? "bg-green-100 text-green-700" : isFailed ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700"}`}>
            {isPending && <Loader2 size={9} className="animate-spin" />}
            {isDone ? "✓ Appliqué" : isFailed ? "✗ Erreur" : "En cours…"}
          </span>
        </div>
        {isDone && (
          <p className="mt-1 text-xs text-gray-400">
            {asset.filename} remplacé sur R2 · {job.confirmedStart !== null && job.confirmedEnd !== null ? `${fmt(job.confirmedEnd - job.confirmedStart)} conservés` : ""}
          </p>
        )}
        {isFailed && job.errorMsg && (
          <p className="mt-1 text-xs text-red-500 truncate">{job.errorMsg}</p>
        )}
      </div>
    );
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      {/* Filename */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-900 truncate max-w-sm">{asset.filename}</span>
        {duration > 0 && <span className="text-xs text-gray-400">{fmt(duration)}</span>}
      </div>

      <div className="flex gap-4 p-4">
        {/* Lecteur contraint */}
        <TrimPlayer
          src={asset.url}
          trimStart={trimStart}
          trimEnd={trimEnd}
          videoRef={videoRef}
        />

        {/* Transcript + timing */}
        <div className="flex-1 flex flex-col gap-3 min-w-0">
          {/* Sélecteur de prises si plusieurs détectées */}
          {takes.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap gap-1.5 items-center">
                <span className="text-xs text-gray-400 font-medium mr-0.5">Prises :</span>
                {takes.map((take, idx) => {
                  const isSelected = idx === selectedTakeIndex;
                  const isBest = idx === bestIdx;
                  const scoreColor = take.score >= 70
                    ? (isSelected ? "text-green-200" : "text-green-600")
                    : take.score >= 45
                    ? (isSelected ? "text-yellow-200" : "text-yellow-600")
                    : (isSelected ? "text-red-200" : "text-red-500");
                  return (
                    <button
                      key={idx}
                      onClick={() => handleSelectTake(idx)}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-colors ${
                        isSelected
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300 hover:bg-indigo-50"
                      }`}
                    >
                      <span>Prise {take.index}</span>
                      {isBest && <span className={isSelected ? "text-yellow-300" : "text-yellow-500"}>★</span>}
                      <span className={scoreColor}>{take.score}%</span>
                    </button>
                  );
                })}
              </div>
              {transcriptText && (
                <p className="text-xs text-gray-500 italic line-clamp-2">&ldquo;{transcriptText}&rdquo;</p>
              )}
            </div>
          )}
          {takes.length <= 1 && transcriptText && (
            <p className="text-sm text-gray-600 italic line-clamp-3">&ldquo;{transcriptText}&rdquo;</p>
          )}
          {!transcriptText && job.status === "done" && (
            <p className="text-xs text-gray-400 italic">Pas de transcription disponible</p>
          )}
          {job.errorMsg && (
            <div className="flex items-center gap-1.5 text-xs text-red-600">
              <AlertTriangle size={12} />
              <span className="truncate">{job.errorMsg}</span>
            </div>
          )}

          {/* Timing inputs */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-gray-400 font-medium">Début</span>
              <div className="flex items-center gap-1">
                <button className="p-0.5 rounded hover:bg-gray-100" onClick={() => applyStart(trimStart - 0.04)}>
                  <ChevronLeft size={14} />
                </button>
                <input
                  type="number" step="0.01" value={startInput}
                  onChange={(e) => setStartInput(e.target.value)}
                  onBlur={() => { const v = parseFloat(startInput); if (!isNaN(v)) applyStart(v); else setStartInput(trimStart.toFixed(2)); }}
                  className="w-20 text-center text-sm border border-gray-200 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
                <button className="p-0.5 rounded hover:bg-gray-100" onClick={() => applyStart(trimStart + 0.04)}>
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-gray-400 font-medium">Fin</span>
              <div className="flex items-center gap-1">
                <button className="p-0.5 rounded hover:bg-gray-100" onClick={() => applyEnd(trimEnd - 0.04)}>
                  <ChevronLeft size={14} />
                </button>
                <input
                  type="number" step="0.01" value={endInput}
                  onChange={(e) => setEndInput(e.target.value)}
                  onBlur={() => { const v = parseFloat(endInput); if (!isNaN(v)) applyEnd(v); else setEndInput(trimEnd.toFixed(2)); }}
                  className="w-20 text-center text-sm border border-gray-200 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
                <button className="p-0.5 rounded hover:bg-gray-100" onClick={() => applyEnd(trimEnd + 0.04)}>
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-gray-400 font-medium">Durée</span>
              <span className="text-sm text-gray-700 px-2 py-0.5">{fmt(Math.max(0, trimEnd - trimStart))}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
        <button
          onClick={() => void handleSkip()} disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
          Passer
        </button>
        <button
          onClick={() => void handleAccept()} disabled={saving}
          className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          Valider
        </button>
      </div>
    </div>
  );
}
