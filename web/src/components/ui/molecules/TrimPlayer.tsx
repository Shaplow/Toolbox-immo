"use client";

/**
 * TrimPlayer — éditeur de trim vidéo dédié.
 *
 * Plus avancé que VideoPlayer variant="trim" :
 * - Dual-range timeline séparée de la vidéo (au-dessus, espace dédié).
 * - Frame nudge ±1f sur chaque borne (précision FFmpeg).
 * - Timecode display HH:MM:SS.FF (frame count) editable inline.
 * - Boutons jump start / play preview trim / jump end.
 * - Affichage de la durée trim sélectionnée (différentiel).
 *
 * Use cases :
 * - MediaAssetEditModal (édition rushes via RunPod)
 * - AutocutReviewCard (review des cut points Whisper)
 *
 * Doctrine Liquid Glass v2 :
 * - Surface glass-strong autour du player.
 * - Timeline trim : track ring inset + range peach gradient + handles
 *   ronds glass spéculaires.
 * - Controls : ButtonIcon glass + NumberStepper pour timecode.
 */

import { useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Minus,
  Plus,
} from "lucide-react";
import { VideoPlayer } from "./VideoPlayer";
import { ButtonIcon } from "../ButtonIcon";

interface TrimPlayerProps {
  src: string | string[];
  poster?: string;
  /** Frame rate de la vidéo. Default 25 (PAL). */
  fps?: number;
  /** Borne min du trim (seconds). Default 0. */
  start?: number;
  /** Borne max du trim (seconds). Default duration. */
  end?: number;
  onChange?: (start: number, end: number) => void;
  /** Aspect du player. Default 16:9. */
  aspect?: "9:16" | "16:9" | "1:1";
  className?: string;
}

function formatTC(s: number, fps: number): string {
  if (!Number.isFinite(s) || s < 0) return "00:00:00.00";
  const totalFrames = Math.floor(s * fps);
  const ff = totalFrames % fps;
  const totalSec = Math.floor(s);
  const hh = Math.floor(totalSec / 3600);
  const mm = Math.floor((totalSec % 3600) / 60);
  const ss = totalSec % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(ff).padStart(2, "0")}`;
}

export function TrimPlayer({
  src,
  poster,
  fps = 25,
  start,
  end,
  onChange,
  aspect = "16:9",
  className,
}: TrimPlayerProps) {
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [trimStart, setTrimStart] = useState(start ?? 0);
  const [trimEnd, setTrimEnd] = useState(end ?? duration);
  const videoElRef = useRef<HTMLVideoElement | null>(null);

  // Sync from props.
  useEffect(() => {
    if (start !== undefined) setTrimStart(start);
  }, [start]);
  useEffect(() => {
    if (end !== undefined) setTrimEnd(end);
    else if (duration > 0 && trimEnd === 0) setTrimEnd(duration);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [end, duration]);

  // Trouver la balise <video> dans le DOM pour piloter les actions.
  // Le VideoPlayer interne nous donne onTimeUpdate, mais on a besoin de seek
  // direct sur certaines actions. Pour rester simple, on utilise une ref via
  // querySelector au premier render après ouverture.
  useEffect(() => {
    const el = document.querySelector<HTMLVideoElement>("[data-trim-player] video");
    videoElRef.current = el;
  }, []);

  function seek(t: number) {
    const v = videoElRef.current;
    if (v) v.currentTime = t;
  }

  function play() {
    videoElRef.current?.play().catch(() => {});
  }
  function pause() {
    videoElRef.current?.pause();
  }

  function nudge(target: "start" | "end", delta: number) {
    const frameSec = 1 / fps;
    if (target === "start") {
      const next = Math.max(0, Math.min(trimEnd - frameSec, trimStart + delta * frameSec));
      setTrimStart(next);
      onChange?.(next, trimEnd);
    } else {
      const next = Math.min(duration, Math.max(trimStart + frameSec, trimEnd + delta * frameSec));
      setTrimEnd(next);
      onChange?.(trimStart, next);
    }
  }

  function updateStart(next: number) {
    const safe = Math.max(0, Math.min(next, trimEnd - 1 / fps));
    setTrimStart(safe);
    onChange?.(safe, trimEnd);
  }
  function updateEnd(next: number) {
    const safe = Math.min(duration, Math.max(next, trimStart + 1 / fps));
    setTrimEnd(safe);
    onChange?.(trimStart, safe);
  }

  const startPct = duration === 0 ? 0 : (trimStart / duration) * 100;
  const endPct = duration === 0 ? 100 : (trimEnd / duration) * 100;
  const playheadPct = duration === 0 ? 0 : (currentTime / duration) * 100;

  const trimDuration = Math.max(0, trimEnd - trimStart);

  return (
    <div
      data-trim-player
      className={[
        "rounded-lg overflow-hidden bg-card border border-border",
        className ?? "",
      ].filter(Boolean).join(" ")}
    >
      {/* Player */}
      <VideoPlayer
        src={src}
        poster={poster}
        variant="minimal"
        aspect={aspect}
        onTimeUpdate={(t) => {
          setCurrentTime(t);
          // Clamp playback dans la sélection trim.
          if (playing && (t < trimStart || t > trimEnd)) {
            seek(trimStart);
          }
        }}
        onDurationChange={(d) => {
          setDuration(d);
          if (end === undefined) setTrimEnd(d);
        }}
        onEnded={() => setPlaying(false)}
        className="rounded-none"
      />

      {/* Trim timeline */}
      <div className="px-4 py-3 border-t border-white/40 bg-white/20 backdrop-blur-[8px]">
        <div className="relative h-8 mb-2">
          {/* Track */}
          <div className="absolute inset-y-1/2 left-0 right-0 h-2 -translate-y-1/2 rounded-full bg-gray-200/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.6),inset_0_0_0_1px_rgba(15,23,42,0.06)]" />
          {/* Selected range */}
          <div
            className="absolute inset-y-1/2 h-2 -translate-y-1/2 rounded-full bg-gradient-to-r from-primary/70 to-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]"
            style={{ left: `${startPct}%`, right: `${100 - endPct}%` }}
          />
          {/* Playhead */}
          <div
            className="absolute inset-y-0 w-0.5 bg-gray-950 shadow-[0_0_0_2px_rgba(255,255,255,0.65)]"
            style={{ left: `${playheadPct}%` }}
            aria-hidden
          />
          {/* Start handle */}
          <input
            type="range"
            min={0}
            max={duration}
            step={1 / fps}
            value={trimStart}
            onChange={(e) => updateStart(Number(e.target.value))}
            className="absolute inset-0 w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:rounded-md [&::-webkit-slider-thumb]:bg-gradient-to-b [&::-webkit-slider-thumb]:from-white [&::-webkit-slider-thumb]:to-white/85 [&::-webkit-slider-thumb]:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),0_2px_4px_rgba(15,23,42,0.18)] [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:cursor-grab"
            aria-label="Début du trim"
          />
          {/* End handle */}
          <input
            type="range"
            min={0}
            max={duration}
            step={1 / fps}
            value={trimEnd}
            onChange={(e) => updateEnd(Number(e.target.value))}
            className="absolute inset-0 w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:rounded-md [&::-webkit-slider-thumb]:bg-gradient-to-b [&::-webkit-slider-thumb]:from-white [&::-webkit-slider-thumb]:to-white/85 [&::-webkit-slider-thumb]:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),0_2px_4px_rgba(15,23,42,0.18)] [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:cursor-grab"
            aria-label="Fin du trim"
          />
        </div>

        {/* Controls row : timecode + nudge + transport */}
        <div className="flex items-center justify-between gap-3 text-[11px] font-mono text-gray-700 flex-wrap">
          {/* Start TC + nudge */}
          <div className="inline-flex items-center gap-1">
            <span className="uppercase tracking-widest font-sans text-[10px] text-gray-500 mr-1">Début</span>
            <ButtonIcon icon={Minus} label="-1 frame début" variant="ghost" size="sm" onClick={() => nudge("start", -1)} />
            <span className="tabular-nums text-gray-950 font-semibold min-w-[7rem] text-center">{formatTC(trimStart, fps)}</span>
            <ButtonIcon icon={Plus} label="+1 frame début" variant="ghost" size="sm" onClick={() => nudge("start", 1)} />
          </div>

          {/* Transport */}
          <div className="inline-flex items-center gap-1">
            <ButtonIcon icon={SkipBack} label="Aller au début du trim" variant="ghost" size="sm" onClick={() => seek(trimStart)} />
            {playing ? (
              <ButtonIcon icon={Pause} label="Pause" variant="ghost" size="sm" onClick={() => { pause(); setPlaying(false); }} />
            ) : (
              <ButtonIcon
                icon={Play}
                label="Lire la sélection"
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (currentTime < trimStart || currentTime > trimEnd) seek(trimStart);
                  play();
                  setPlaying(true);
                }}
              />
            )}
            <ButtonIcon icon={SkipForward} label="Aller à la fin du trim" variant="ghost" size="sm" onClick={() => seek(trimEnd - 1 / fps)} />
            <span className="ml-2 text-gray-500 tabular-nums">
              Durée <span className="text-gray-950 font-semibold">{formatTC(trimDuration, fps)}</span>
            </span>
          </div>

          {/* End TC + nudge */}
          <div className="inline-flex items-center gap-1">
            <span className="uppercase tracking-widest font-sans text-[10px] text-gray-500 mr-1">Fin</span>
            <ButtonIcon icon={Minus} label="-1 frame fin" variant="ghost" size="sm" onClick={() => nudge("end", -1)} />
            <span className="tabular-nums text-gray-950 font-semibold min-w-[7rem] text-center">{formatTC(trimEnd, fps)}</span>
            <ButtonIcon icon={Plus} label="+1 frame fin" variant="ghost" size="sm" onClick={() => nudge("end", 1)} />
          </div>
        </div>
      </div>
    </div>
  );
}

