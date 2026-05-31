"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Check, ToggleLeft, ToggleRight, Play } from "lucide-react";
import type { Segment } from "@/lib/transcriptionProcess";

// ─── Types ────────────────────────────────────────────────────────────────────

type SegmentState = {
  included: boolean;
  trimStartIdx: number;
  trimEndIdx: number;
};

type Props = {
  segments: Segment[];
  videoFile: File | null;
  onConfirm: (srt: string, segments: Segment[]) => void;
  onCancel: () => void;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function buildFinalSrt(segments: Segment[], states: SegmentState[]): string {
  const lines: string[] = [];
  let idx = 1;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const state = states[i];
    if (!state.included) continue;

    const hasWords = Array.isArray(seg.words) && seg.words.length > 0;
    let start: number;
    let end: number;
    let text: string;

    if (hasWords) {
      const words = seg.words!;
      const si = Math.min(state.trimStartIdx, words.length - 1);
      const ei = Math.max(Math.min(state.trimEndIdx, words.length - 1), si);
      start = words[si].start;
      end = words[ei].end;
      text = words.slice(si, ei + 1).map((w) => w.word).join(" ");
    } else {
      start = seg.start;
      end = seg.end;
      text = seg.text;
    }

    lines.push(String(idx));
    lines.push(`${toSrtTime(start)} --> ${toSrtTime(end)}`);
    lines.push(text);
    lines.push("");
    idx++;
  }

  return lines.join("\n");
}

function buildFinalSegments(segments: Segment[], states: SegmentState[]): Segment[] {
  const result: Segment[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const state = states[i];
    if (!state.included) continue;
    const hasWords = Array.isArray(seg.words) && seg.words.length > 0;
    if (hasWords) {
      const words = seg.words!;
      const si = Math.min(state.trimStartIdx, words.length - 1);
      const ei = Math.max(Math.min(state.trimEndIdx, words.length - 1), si);
      const trimmedWords = words.slice(si, ei + 1);
      result.push({
        start: trimmedWords[0].start,
        end: trimmedWords[trimmedWords.length - 1].end,
        text: trimmedWords.map((w) => w.word).join(" "),
        words: trimmedWords,
        ...(seg.speaker ? { speaker: seg.speaker } : {}),
      });
    } else {
      result.push({ start: seg.start, end: seg.end, text: seg.text, ...(seg.speaker ? { speaker: seg.speaker } : {}) });
    }
  }
  return result;
}

export function SegmentTrimEditor({ segments, videoFile, onConfirm, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoUrl = useRef<string | null>(null);
  const [activeSegmentIdx, setActiveSegmentIdx] = useState<number | null>(null);

  const initStates = useCallback((): SegmentState[] =>
    segments.map((seg) => ({
      included: true,
      trimStartIdx: 0,
      trimEndIdx: (seg.words?.length ?? 1) - 1,
    })), [segments]);

  const [states, setStates] = useState<SegmentState[]>(initStates);

  // Reset states when segments change
  useEffect(() => {
    setStates(initStates());
  }, [initStates]);

  // Create video object URL
  useEffect(() => {
    if (!videoFile) return;
    const url = URL.createObjectURL(videoFile);
    videoUrl.current = url;
    if (videoRef.current) videoRef.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [videoFile]);

  // Sync active segment from video timeupdate
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const handleTimeUpdate = () => {
      const t = video.currentTime;
      const idx = segments.findIndex((seg) => t >= seg.start && t < seg.end);
      setActiveSegmentIdx(idx >= 0 ? idx : null);
    };
    video.addEventListener("timeupdate", handleTimeUpdate);
    return () => video.removeEventListener("timeupdate", handleTimeUpdate);
  }, [segments]);

  const seekTo = useCallback((time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      void videoRef.current.play();
    }
  }, []);

  const toggleSegment = useCallback((i: number) => {
    setStates((prev) => prev.map((s, idx) => idx === i ? { ...s, included: !s.included } : s));
  }, []);

  const toggleAll = useCallback((included: boolean) => {
    setStates((prev) => prev.map((s) => ({ ...s, included })));
  }, []);

  const handleWordClick = useCallback((segIdx: number, wordIdx: number) => {
    setStates((prev) => {
      const s = prev[segIdx];
      // First click after full selection OR if clicking before trimStart → set new trimStart
      if (wordIdx <= s.trimStartIdx || wordIdx < s.trimEndIdx) {
        return prev.map((st, i) => i === segIdx ? { ...st, trimStartIdx: wordIdx } : st);
      }
      // Clicking after trimStart → set trimEnd
      return prev.map((st, i) => i === segIdx ? { ...st, trimEndIdx: wordIdx } : st);
    });
  }, []);

  const resetTrim = useCallback((segIdx: number) => {
    setStates((prev) => prev.map((s, i) =>
      i === segIdx
        ? { ...s, trimStartIdx: 0, trimEndIdx: (segments[i].words?.length ?? 1) - 1 }
        : s
    ));
  }, [segments]);

  const totalDuration = segments.length > 0 ? segments[segments.length - 1].end : 1;
  const includedCount = states.filter((s) => s.included).length;

  const handleConfirm = () => {
    const srt = buildFinalSrt(segments, states);
    const segs = buildFinalSegments(segments, states);
    onConfirm(srt, segs);
  };

  return (
    <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden mb-3">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div>
          <p className="text-sm font-semibold text-gray-900">Révision des sous-titres</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {includedCount}/{segments.length} segments actifs
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => toggleAll(true)}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Tout activer
          </button>
          <button
            type="button"
            onClick={() => toggleAll(false)}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Tout désactiver
          </button>
        </div>
      </div>

      {/* Video player */}
      {videoFile && (
        <div className="px-5 pt-4">
          <div className="relative aspect-video rounded-xl overflow-hidden bg-gray-900">
            <video
              ref={videoRef}
              className="absolute inset-0 w-full h-full object-contain"
              controls
            />
          </div>
        </div>
      )}

      {/* Mini timeline */}
      <div className="px-5 py-3">
        <div className="relative h-3 rounded-full bg-gray-100 overflow-hidden">
          {segments.map((seg, i) => {
            const left = (seg.start / totalDuration) * 100;
            const width = Math.max(((seg.end - seg.start) / totalDuration) * 100, 0.3);
            const isActive = activeSegmentIdx === i;
            return (
              <button
                key={i}
                type="button"
                title={seg.text}
                onClick={() => seekTo(seg.start)}
                style={{ left: `${left}%`, width: `${width}%` }}
                className={`absolute h-full transition-colors ${
                  states[i].included
                    ? isActive ? "bg-sky-500" : "bg-teal-300 hover:bg-teal-400"
                    : "bg-gray-300 hover:bg-gray-400"
                }`}
              />
            );
          })}
        </div>
      </div>

      {/* Segments list */}
      <div className="px-5 pb-4 space-y-2 max-h-96 overflow-y-auto">
        {segments.map((seg, i) => {
          const state = states[i];
          const hasWords = Array.isArray(seg.words) && seg.words.length > 0;
          const isActive = activeSegmentIdx === i;

          return (
            <div
              key={i}
              className={`rounded-xl border transition-all ${
                isActive
                  ? "border-teal-300 bg-sky-50"
                  : state.included
                  ? "border-gray-100 bg-gray-50"
                  : "border-gray-100 bg-gray-50 opacity-50"
              }`}
            >
              <div className="flex items-center gap-2 px-3 py-2.5">
                {/* Time */}
                <button
                  type="button"
                  onClick={() => seekTo(seg.start)}
                  className="text-xs text-gray-400 hover:text-teal-600 transition-colors font-mono shrink-0 flex items-center gap-1"
                  title="Aller à ce segment"
                >
                  <Play size={9} />
                  {fmtTime(seg.start)}
                </button>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  {hasWords ? (
                    <div
                      className="flex flex-wrap gap-0.5"
                      onDoubleClick={() => resetTrim(i)}
                      title="Double-clic pour réinitialiser la sélection"
                    >
                      {seg.words!.map((w, wi) => {
                        const isInRange = wi >= state.trimStartIdx && wi <= state.trimEndIdx;
                        return (
                          <button
                            key={wi}
                            type="button"
                            onClick={() => handleWordClick(i, wi)}
                            className={`text-xs px-1 py-0.5 rounded transition-all ${
                              isInRange
                                ? "bg-sky-100 text-teal-800 hover:bg-teal-200"
                                : "bg-white text-gray-300 hover:text-gray-500"
                            }`}
                          >
                            {w.word}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-700 truncate">{seg.text}</p>
                  )}
                </div>

                {/* Toggle */}
                <button
                  type="button"
                  onClick={() => toggleSegment(i)}
                  className={`shrink-0 transition-colors ${
                    state.included ? "text-teal-600 hover:text-teal-700" : "text-gray-300 hover:text-gray-500"
                  }`}
                  title={state.included ? "Désactiver" : "Activer"}
                >
                  {state.included
                    ? <ToggleRight size={20} />
                    : <ToggleLeft size={20} />
                  }
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-gray-100 bg-gray-50">
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={includedCount === 0}
          className="flex items-center gap-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-colors"
        >
          <Check size={14} />
          Confirmer et continuer
        </button>
      </div>
    </div>
  );
}
