"use client";

/**
 * VideoPlayer — lecteur vidéo polyvalent Liquid Glass.
 *
 * Factorise ~15 surfaces qui utilisent `<video>` custom aujourd'hui
 * (RushesSection, VersionsSection, MediaAssetsVideoCard, CoverGenerator,
 * MediaAssetEditModal, AutocutReviewCard, validate/[token]…).
 *
 * Doctrine Liquid Glass v2 :
 * - Chrome glass (controls) optionnel — bandeau bas backdrop-blur + ring inset.
 * - Play button center : FAB rond glass-strong avec halo extérieur.
 * - Progress bar : track ring inset + fill gradient color + thumb spéculaire.
 * - Caption layer : badge glass tinted bas (au-dessus des controls).
 * - Trim controls : dual-range glass + handles ronds glass spéculaires.
 *
 * 5 variants :
 * - `native`     : controls HTML natifs (rapide, mais hideux — debug only)
 * - `minimal`    : play/pause center + progress bar bas glass (default)
 * - `captions`   : minimal + caption layer animée à partir de `captions[]`
 * - `trim`       : minimal + dual-range trimmer (rushes/édition)
 * - `fullscreen` : minimal + chrome étendu (volume + fullscreen toggle)
 *
 * Props notables :
 * - `aspect` : "9:16" (default) | "16:9" | "1:1" | "auto"
 * - `glassChrome` : si true, chrome bottom passe en glass-tinted
 * - `trimStart` / `trimEnd` (variant="trim") : init du dual-range
 * - `onTrimChange` (variant="trim") : callback dual-range
 * - `captions` : array { start, end, text } pour variant="captions"
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

type Aspect = "9:16" | "16:9" | "1:1" | "auto";
type Variant = "native" | "minimal" | "captions" | "trim" | "fullscreen";

export interface CaptionLine {
  start: number;
  end: number;
  text: string;
}

interface VideoPlayerProps {
  src: string | string[];
  poster?: string;
  aspect?: Aspect;
  variant?: Variant;
  loop?: boolean;
  /** Default true (muet pour permettre l'autoplay). */
  muted?: boolean;
  autoplay?: boolean;
  /** Seek initial (seconds). */
  startAt?: number;
  trimStart?: number;
  trimEnd?: number;
  captions?: CaptionLine[];
  /** Chrome controls glass-tinted (au lieu de gray-950 backdrop). */
  glassChrome?: boolean;
  /** Callback de mise à jour du temps (variant=trim/captions souvent utile). */
  onTimeUpdate?: (currentTime: number) => void;
  /** Callback fin de lecture. */
  onEnded?: () => void;
  /** Callback dual-range trim (variant="trim"). */
  onTrimChange?: (start: number, end: number) => void;
  /** Callback duration connue (loadedmetadata). Utile pour TrimPlayer. */
  onDurationChange?: (duration: number) => void;
  /** Classes additionnelles sur le wrapper. */
  className?: string;
}

const ASPECT_CLS: Record<Aspect, string> = {
  "9:16": "aspect-[9/16]",
  "16:9": "aspect-video",
  "1:1":  "aspect-square",
  "auto": "",
};

function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

// ─── Composant principal ────────────────────────────────────────────────────

export function VideoPlayer({
  src,
  poster,
  aspect = "9:16",
  variant = "minimal",
  loop = false,
  // Default muted=false avec volume initial 50% — son léger audible dès la
  // lecture. Si l'usage veut autoplay, passer explicitement muted=true
  // (sinon les browsers blockent le start sans interaction).
  muted = false,
  autoplay = false,
  startAt,
  trimStart,
  trimEnd,
  captions = [],
  glassChrome = true,
  onTimeUpdate,
  onEnded,
  onTrimChange,
  onDurationChange,
  className,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(muted);
  // Volume initial 50% (au lieu de 1) — équilibre entre audible et non-intrusif.
  const [volume, setVolume] = useState(0.5);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Slider volume : caché par défaut, apparaît au click sur l'icone volume.
  const [volumeOpen, setVolumeOpen] = useState(false);

  // Trim state (controlled via props si fourni, sinon local).
  const [trimRange, setTrimRange] = useState<[number, number]>([
    trimStart ?? 0,
    trimEnd ?? Number.POSITIVE_INFINITY,
  ]);

  const sources = Array.isArray(src) ? src : [src];

  // Sync trim state when props change.
  useEffect(() => {
    if (variant !== "trim") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTrimRange([trimStart ?? 0, trimEnd ?? duration ?? 0]);
  }, [trimStart, trimEnd, duration, variant]);

  // Seek to startAt on load.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || startAt === undefined) return;
    const handler = () => {
      v.currentTime = startAt;
    };
    v.addEventListener("loadedmetadata", handler);
    return () => v.removeEventListener("loadedmetadata", handler);
  }, [startAt]);

  // Sync isMuted with video element on mount.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = isMuted;
    v.volume = volume;
  }, [isMuted, volume]);

  // Fullscreen change listener.
  useEffect(() => {
    function handler() {
      setIsFullscreen(document.fullscreenElement === wrapperRef.current);
    }
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // Trim mode : clamp playback to trimRange.
  useEffect(() => {
    if (variant !== "trim") return;
    const v = videoRef.current;
    if (!v) return;
    const onUpdate = () => {
      if (v.currentTime < trimRange[0]) v.currentTime = trimRange[0];
      if (v.currentTime > trimRange[1]) {
        v.currentTime = trimRange[0];
        v.pause();
        setPlaying(false);
      }
    };
    v.addEventListener("timeupdate", onUpdate);
    return () => v.removeEventListener("timeupdate", onUpdate);
  }, [variant, trimRange]);

  // ─── Handlers ────────────────────────────────────────────────────────────

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, []);


  const seek = useCallback((time: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = time;
  }, []);

  const seekToPercent = useCallback(
    (pct: number) => {
      const t = (Math.max(0, Math.min(100, pct)) / 100) * duration;
      seek(t);
    },
    [duration, seek],
  );

  const toggleFullscreen = useCallback(() => {
    const w = wrapperRef.current;
    if (!w) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      w.requestFullscreen().catch(() => {});
    }
  }, []);

  // ─── Caption courante (variant captions) ─────────────────────────────────

  const currentCaption = captions.find(
    (c) => currentTime >= c.start && currentTime < c.end,
  );

  // ─── Rendu ───────────────────────────────────────────────────────────────

  const showNativeControls = variant === "native";
  const showOverlayControls = variant !== "native";

  return (
    <div
      ref={wrapperRef}
      className={[
        "relative overflow-hidden rounded-xl bg-black",
        ASPECT_CLS[aspect],
        // Ring inset signature autour de la vidéo (matière liquid glass).
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.18),inset_0_0_0_1px_rgba(255,255,255,0.08),0_8px_24px_-6px_rgba(15,23,42,0.18)]",
        className ?? "",
      ].filter(Boolean).join(" ")}
    >
      <video
        ref={videoRef}
        loop={loop}
        muted={isMuted}
        autoPlay={autoplay}
        playsInline
        controls={showNativeControls}
        poster={poster}
        className="h-full w-full object-cover"
        onClick={showOverlayControls ? togglePlay : undefined}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => {
          const t = (e.currentTarget as HTMLVideoElement).currentTime;
          setCurrentTime(t);
          onTimeUpdate?.(t);
        }}
        onLoadedMetadata={(e) => {
          const d = (e.currentTarget as HTMLVideoElement).duration;
          setDuration(d);
          onDurationChange?.(d);
        }}
        onEnded={() => {
          setPlaying(false);
          onEnded?.();
        }}
      >
        {sources.map((s) => (
          <source key={s} src={s} />
        ))}
      </video>

      {/* Caption layer */}
      {variant === "captions" && currentCaption && (
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 max-w-[90%] pointer-events-none">
          <p
            className={[
              "px-3 py-1.5 rounded-md text-[13px] font-medium text-white text-center leading-tight",
              "bg-gray-950/55 backdrop-blur-[8px] backdrop-saturate-150",
              "shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_4px_12px_-2px_rgba(0,0,0,0.32)]",
            ].join(" ")}
          >
            {currentCaption.text}
          </p>
        </div>
      )}

      {/* Chrome bottom — overlay controls ultra-discret 1-ligne.
          progress flex-1 | time | volume (slider on-demand) */}
      {showOverlayControls && (
        <div
          className={[
            "absolute left-0 right-0 bottom-0 px-2.5 py-2",
            glassChrome
              ? "bg-gradient-to-t from-black/45 via-black/15 to-transparent"
              : "bg-gradient-to-t from-black/55 to-transparent",
          ].join(" ")}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <ProgressBar
                value={duration > 0 ? (currentTime / duration) * 100 : 0}
                onChange={seekToPercent}
              />
            </div>
            <span className="text-[10px] font-mono text-white/85 tabular-nums shrink-0 select-none">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>

            {/* Volume — slider vertical glass popup au click sur l'icon */}
            <div className="relative shrink-0">
              {volumeOpen && (
                <div
                  className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-2.5 rounded-xl bg-gray-950/55 backdrop-blur-[16px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),inset_0_0_0_1px_rgba(255,255,255,0.08),0_8px_24px_-4px_rgba(0,0,0,0.4)]"
                  onMouseLeave={() => setVolumeOpen(false)}
                >
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={isMuted ? 0 : volume}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setVolume(v);
                      if (v > 0 && isMuted) setIsMuted(false);
                      if (v === 0 && !isMuted) setIsMuted(true);
                    }}
                    className="h-20 w-1 accent-white cursor-pointer"
                    style={{ writingMode: "vertical-lr", direction: "rtl" } as React.CSSProperties}
                    aria-label="Volume"
                  />
                </div>
              )}
              <ChromeButton
                onClick={() => setVolumeOpen((o) => !o)}
                label="Régler le son"
              >
                {isMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
              </ChromeButton>
            </div>

            {/* Fullscreen — disponible sur toutes les variants overlay */}
            <ChromeButton onClick={toggleFullscreen} label={isFullscreen ? "Quitter le plein écran" : "Plein écran"}>
              {isFullscreen ? <Minimize size={13} /> : <Maximize size={13} />}
            </ChromeButton>
          </div>
        </div>
      )}

      {/* Trim controls — overlay au-dessus du chrome bottom */}
      {variant === "trim" && duration > 0 && (
        <div className="absolute left-3 right-3 bottom-14 z-10">
          <DualRangeTrim
            min={0}
            max={duration}
            valueStart={trimRange[0]}
            valueEnd={trimRange[1] === Number.POSITIVE_INFINITY ? duration : trimRange[1]}
            onChange={(s, e) => {
              setTrimRange([s, e]);
              onTrimChange?.(s, e);
            }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function ProgressBar({ value, onChange }: { value: number; onChange: (pct: number) => void }) {
  const trackRef = useRef<HTMLDivElement>(null);

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    onChange(pct);
  }

  return (
    <div
      ref={trackRef}
      onClick={handleClick}
      className="flex-1 h-1.5 rounded-full bg-white/20 cursor-pointer overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full bg-gradient-to-r from-white/95 to-white/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] transition-[width]"
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

function ChromeButton({
  children,
  onClick,
  label,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="inline-flex items-center justify-center h-7 w-7 rounded-md text-white/85 hover:text-white hover:bg-white/15 transition-all focus-ring"
    >
      {children}
    </button>
  );
}

function DualRangeTrim({
  min,
  max,
  valueStart,
  valueEnd,
  onChange,
}: {
  min: number;
  max: number;
  valueStart: number;
  valueEnd: number;
  onChange: (start: number, end: number) => void;
}) {
  const startPct = max === min ? 0 : ((valueStart - min) / (max - min)) * 100;
  const endPct = max === min ? 100 : ((valueEnd - min) / (max - min)) * 100;

  return (
    <div className="relative h-6">
      {/* Track */}
      <div className="absolute inset-y-1/2 left-0 right-0 h-1.5 -translate-y-1/2 rounded-full bg-white/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]" />
      {/* Selected range */}
      <div
        className="absolute inset-y-1/2 h-1.5 -translate-y-1/2 rounded-full bg-gradient-to-r from-primary/70 to-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]"
        style={{ left: `${startPct}%`, right: `${100 - endPct}%` }}
      />
      {/* Start handle */}
      <input
        type="range"
        min={min}
        max={max}
        step={0.1}
        value={valueStart}
        onChange={(e) => onChange(Math.min(Number(e.target.value), valueEnd - 0.1), valueEnd)}
        className="absolute inset-0 w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),0_2px_4px_rgba(15,23,42,0.18)] [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:cursor-grab"
        aria-label="Début du trim"
      />
      {/* End handle */}
      <input
        type="range"
        min={min}
        max={max}
        step={0.1}
        value={valueEnd}
        onChange={(e) => onChange(valueStart, Math.max(Number(e.target.value), valueStart + 0.1))}
        className="absolute inset-0 w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),0_2px_4px_rgba(15,23,42,0.18)] [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:cursor-grab"
        aria-label="Fin du trim"
      />
    </div>
  );
}
