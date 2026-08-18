"use client";

/**
 * TrimPlayer — éditeur de trim vidéo dédié.
 *
 * Plus avancé que VideoPlayer variant="trim" :
 * - Dual-range timeline séparée de la vidéo (au-dessus, espace dédié), avec
 *   seek au clic sur la piste.
 * - Frame nudge ±1f sur chaque borne (précision FFmpeg).
 * - Timecode display HH:MM:SS.FF (frame count) editable inline.
 * - Boutons jump start / play preview trim / jump end.
 * - Affichage de la durée trim sélectionnée (différentiel).
 * - Marqueurs optionnels sur la timeline (ex : fin de parole détectée).
 * - Lecture bornée à [start, end] par défaut, ou libre sur tout le fichier
 *   via `constrainPlayback={false}` (prévisualisation en contexte).
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
import { clamp } from "@/lib/time";

export interface TrimPlayerMarker {
  /** Position (secondes) sur la timeline complète. */
  time: number;
  tone?: "info" | "warning" | "danger" | "success";
  /** Titre au survol + suffixe visuel (légende affichée par le consommateur). */
  label?: string;
}

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
  /** Durée réelle de la vidéo, connue à la lecture des métadonnées. */
  onDurationChange?: (duration: number) => void;
  /** Aspect du player. Default 16:9. */
  aspect?: "9:16" | "16:9" | "1:1";
  className?: string;
  /**
   * Si false, la lecture n'est pas bornée à [start, end] : elle parcourt tout
   * le fichier (utile pour prévisualiser la sélection dans son contexte,
   * ex. rush complet). Default true.
   */
  constrainPlayback?: boolean;
  /** Marqueurs additionnels sur la timeline (ex : fin de parole Whisper). */
  markers?: TrimPlayerMarker[];
}

const MARKER_TONE_CLS: Record<NonNullable<TrimPlayerMarker["tone"]>, string> = {
  info: "bg-info-600",
  warning: "bg-warning-600",
  danger: "bg-danger-600",
  success: "bg-success-600",
};

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

/**
 * Inverse de formatTC — accepte HH:MM:SS.FF (frame count, pas centisecondes),
 * ou un simple nombre décimal de secondes (ex. "12.5") en fallback : les
 * anciennes implémentations locales acceptaient une saisie directe en
 * secondes, on garde cette ergonomie en plus du format structuré.
 */
function parseTC(str: string, fps: number): number | null {
  const trimmed = str.trim();
  const m = trimmed.match(/^(\d+):([0-5]?\d):([0-5]?\d)\.(\d{1,2})$/);
  if (m) {
    const h = Number(m[1]);
    const mm = Number(m[2]);
    const ss = Number(m[3]);
    const ff = Number(m[4]);
    if (ff >= fps) return null;
    return h * 3600 + mm * 60 + ss + ff / fps;
  }
  const asNumber = Number(trimmed.replace(",", "."));
  return Number.isFinite(asNumber) && trimmed !== "" ? asNumber : null;
}

export function TrimPlayer({
  src,
  poster,
  fps = 25,
  start,
  end,
  onChange,
  onDurationChange,
  aspect = "16:9",
  className,
  constrainPlayback = true,
  markers,
}: TrimPlayerProps) {
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [trimStart, setTrimStart] = useState(start ?? 0);
  const [trimEnd, setTrimEnd] = useState(end ?? duration);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);

  // Timecodes éditables — state string séparé pour ne pas reformatter la
  // valeur pendant la frappe (uniquement au blur/Enter, comme les anciennes
  // implémentations locales).
  const [startText, setStartText] = useState(() => formatTC(start ?? 0, fps));
  const [endText, setEndText] = useState(() => formatTC(end ?? 0, fps));

  // Sync from props. Le seek sur changement externe de `start` couvre le cas
  // "sélection d'une autre prise" (AutocutReviewCard) : on prévisualise depuis
  // le nouveau début, comme le faisaient les implémentations locales.
  useEffect(() => {
    if (start === undefined) return;
    setTrimStart(start);
    seek(start);
  }, [start]);
  useEffect(() => {
    if (end !== undefined) setTrimEnd(end);
    else if (duration > 0 && trimEnd === 0) setTrimEnd(duration);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [end, duration]);

  useEffect(() => { setStartText(formatTC(trimStart, fps)); }, [trimStart, fps]);
  useEffect(() => { setEndText(formatTC(trimEnd, fps)); }, [trimEnd, fps]);

  // Trouver la balise <video> dans le DOM pour piloter les actions.
  // Le VideoPlayer interne nous donne onTimeUpdate, mais on a besoin de seek
  // direct sur certaines actions. On scope la recherche au wrapper de CETTE
  // instance (querySelector global cassait toute liste de plusieurs
  // TrimPlayer montés simultanément — chacun retombait sur la 1ʳᵉ vidéo du
  // document — cas réel dès qu'une review queue affiche plusieurs cartes).
  useEffect(() => {
    const el = wrapperRef.current?.querySelector<HTMLVideoElement>("video") ?? null;
    videoElRef.current = el;
  }, []);

  function seek(t: number) {
    const v = videoElRef.current;
    if (v) v.currentTime = t;
    setCurrentTime(t);
  }

  function play() {
    videoElRef.current?.play().catch(() => {});
  }
  function pause() {
    videoElRef.current?.pause();
  }

  // Chaque édition de borne (drag, nudge, commit numérique) re-seek le
  // lecteur sur la borne modifiée — preview immédiate de l'endroit exact où
  // tombe la coupe, comme le faisaient les deux implémentations locales.
  function nudge(target: "start" | "end", delta: number) {
    const frameSec = 1 / fps;
    if (target === "start") {
      const next = clamp(trimStart + delta * frameSec, 0, trimEnd - frameSec);
      setTrimStart(next);
      seek(next);
      onChange?.(next, trimEnd);
    } else {
      const next = clamp(trimEnd + delta * frameSec, trimStart + frameSec, duration);
      setTrimEnd(next);
      seek(next);
      onChange?.(trimStart, next);
    }
  }

  function updateStart(next: number) {
    const safe = clamp(next, 0, trimEnd - 1 / fps);
    setTrimStart(safe);
    seek(safe);
    onChange?.(safe, trimEnd);
  }
  function updateEnd(next: number) {
    const safe = clamp(next, trimStart + 1 / fps, duration);
    setTrimEnd(safe);
    seek(safe);
    onChange?.(trimStart, safe);
  }

  function commitStartText() {
    const parsed = parseTC(startText, fps);
    if (parsed !== null) updateStart(parsed);
    else setStartText(formatTC(trimStart, fps));
  }
  function commitEndText() {
    const parsed = parseTC(endText, fps);
    if (parsed !== null) updateEnd(parsed);
    else setEndText(formatTC(trimEnd, fps));
  }

  function handleTimelineClick(e: React.MouseEvent<HTMLDivElement>) {
    const el = timelineRef.current;
    if (!el || duration === 0) return;
    const rect = el.getBoundingClientRect();
    const ratio = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    seek(ratio * duration);
  }

  const startPct = duration === 0 ? 0 : (trimStart / duration) * 100;
  const endPct = duration === 0 ? 100 : (trimEnd / duration) * 100;
  const playheadPct = duration === 0 ? 0 : (currentTime / duration) * 100;

  const trimDuration = Math.max(0, trimEnd - trimStart);

  return (
    <div
      ref={wrapperRef}
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
          // Clamp playback dans la sélection trim (mode borné uniquement).
          if (constrainPlayback && playing && (t < trimStart || t > trimEnd)) {
            seek(trimStart);
          }
        }}
        onDurationChange={(d) => {
          setDuration(d);
          if (end === undefined) setTrimEnd(d);
          onDurationChange?.(d);
          // Position initiale sur trimStart une fois les métadonnées prêtes
          // (avant ça, videoElRef n'est pas garanti résolu ni le média seekable).
          seek(trimStart);
        }}
        onEnded={() => setPlaying(false)}
        className="rounded-none"
      />

      {/* Trim timeline */}
      <div className="px-4 py-3 border-t border-border bg-muted">
        <div ref={timelineRef} className="relative h-8 mb-2 cursor-pointer" onClick={handleTimelineClick}>
          {/* Track */}
          <div className="absolute inset-y-1/2 left-0 right-0 h-2 -translate-y-1/2 rounded-full bg-gray-200/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.6),inset_0_0_0_1px_rgba(15,23,42,0.06)]" />
          {/* Selected range */}
          <div
            className="absolute inset-y-1/2 h-2 -translate-y-1/2 rounded-full bg-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]"
            style={{ left: `${startPct}%`, right: `${100 - endPct}%` }}
          />
          {/* Marqueurs additionnels (ex : fin de parole détectée) */}
          {markers?.map((mk, i) => {
            if (duration === 0) return null;
            const pct = clamp((mk.time / duration) * 100, 0, 100);
            return (
              <div
                key={i}
                className={`absolute inset-y-0 w-0.5 rounded-full opacity-90 pointer-events-none ${MARKER_TONE_CLS[mk.tone ?? "info"]}`}
                style={{ left: `${pct}%` }}
                title={mk.label}
                aria-hidden
              />
            );
          })}
          {/* Playhead */}
          <div
            className="absolute inset-y-0 w-0.5 bg-gray-950 shadow-[0_0_0_2px_rgba(255,255,255,0.65)] pointer-events-none"
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
            className="absolute inset-0 w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:rounded-md [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),0_2px_4px_rgba(15,23,42,0.18)] [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:cursor-grab"
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
            className="absolute inset-0 w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:rounded-md [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),0_2px_4px_rgba(15,23,42,0.18)] [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:cursor-grab"
            aria-label="Fin du trim"
          />
        </div>

        {/* Controls row : timecode éditable + nudge + transport */}
        <div className="flex items-center justify-between gap-3 text-[11px] font-mono text-foreground flex-wrap">
          {/* Start TC + nudge */}
          <div className="inline-flex items-center gap-1">
            <span className="uppercase tracking-widest font-sans text-[10px] text-muted-foreground mr-1">Début</span>
            <ButtonIcon icon={Minus} label="-1 frame début" variant="ghost" size="sm" onClick={() => nudge("start", -1)} />
            <input
              type="text"
              inputMode="decimal"
              value={startText}
              onChange={(e) => setStartText(e.target.value)}
              onBlur={commitStartText}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              className="tabular-nums text-foreground font-semibold w-[7rem] text-center bg-transparent border border-transparent rounded hover:border-border focus:outline-none focus:border-border focus-ring"
              aria-label="Timecode de début (éditable)"
            />
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
                label={constrainPlayback ? "Lire la sélection" : "Lecture"}
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (constrainPlayback && (currentTime < trimStart || currentTime > trimEnd)) seek(trimStart);
                  play();
                  setPlaying(true);
                }}
              />
            )}
            <ButtonIcon icon={SkipForward} label="Aller à la fin du trim" variant="ghost" size="sm" onClick={() => seek(trimEnd - 1 / fps)} />
            <span className="ml-2 text-muted-foreground tabular-nums">
              Durée <span className="text-foreground font-semibold">{formatTC(trimDuration, fps)}</span>
            </span>
          </div>

          {/* End TC + nudge */}
          <div className="inline-flex items-center gap-1">
            <span className="uppercase tracking-widest font-sans text-[10px] text-muted-foreground mr-1">Fin</span>
            <ButtonIcon icon={Minus} label="-1 frame fin" variant="ghost" size="sm" onClick={() => nudge("end", -1)} />
            <input
              type="text"
              inputMode="decimal"
              value={endText}
              onChange={(e) => setEndText(e.target.value)}
              onBlur={commitEndText}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              className="tabular-nums text-foreground font-semibold w-[7rem] text-center bg-transparent border border-transparent rounded hover:border-border focus:outline-none focus:border-border focus-ring"
              aria-label="Timecode de fin (éditable)"
            />
            <ButtonIcon icon={Plus} label="+1 frame fin" variant="ghost" size="sm" onClick={() => nudge("end", 1)} />
          </div>
        </div>
      </div>
    </div>
  );
}
