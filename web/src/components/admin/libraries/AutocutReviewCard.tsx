"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Check, X, Loader2, AlertTriangle, Play, Pause, SkipBack, SkipForward, Expand, Shrink } from "lucide-react";

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
interface Word { word: string; start: number; end: number; score?: number; }
type TranscriptSegment = { text: string; start: number; end: number; words?: Word[] };

interface Take {
  index: number;
  segments: TranscriptSegment[];
  start: number; // avec padding
  end: number;   // avec padding
  score: number; // 0–100
  text: string;
}

// Pause ≥ 0.8s entre mots/segments = nouvelle prise.
// Détection prioritaire sur les mots (WhisperX produit des gaps entre mots plus précis
// que les gaps entre segments — Whisper peut regrouper fumble+retake dans un seul segment).
// Fallback sur les segments si les mots ne sont pas disponibles.
const TAKE_GAP_S = 0.8;
const TAKE_PAD_S = 0.15;
// Plafond de durée par mot : Whisper gonfle le `end` du dernier mot d'un groupe
// pour couvrir toute la pause qui suit. Ex : "Paris." start=3.256 end=11.367 alors que
// la parole s'arrête à ~3.5s. Sans ce plafond le gap avec le mot suivant = 0.06s au lieu de ~8s.
const MAX_WORD_DURATION_S = 1.0;
const HESITATION_RE = /\b(euh|heu|hm|donc|alors|ben|voil[aà]|enfin|bref|ouais)\b/gi;

function scoreGroup(
  text: string,
  wordCount: number,
  rawStart: number,
  rawEnd: number,
  avgWordConfidence: number = 0.8,
  takeIndex: number = 0,
  totalTakes: number = 1,
): number {
  // Prise tronquée (fumble interrompu) → score plancher, ne peut jamais être choisie
  const isTruncated = /\.\.\.|…/.test(text);
  if (isTruncated) return Math.min(15, wordCount * 2);

  const lengthScore = Math.min(100, (wordCount / 25) * 100);
  const dur = rawEnd - rawStart;
  const rate = dur > 0 ? wordCount / dur : 0;
  const rateScore = Math.max(0, 100 - Math.abs(rate - 3) * 25);
  const hesCount = (text.match(HESITATION_RE) ?? []).length;
  const hesScore = Math.max(0, 100 - hesCount * 20);
  const completenessScore = /[.!?»"']$/.test(text) ? 100 : 55;
  // Confiance Whisper : signal le plus fiable — 0.9+ = diction nette, 0.3- = bredouillage
  const confidenceScore = avgWordConfidence * 100;
  // Bonus dernière prise : un locuteur recommence toujours en s'améliorant
  const positionBonus = totalTakes > 1 && takeIndex === totalTakes - 1 ? 8 : 0;

  return Math.round(
    lengthScore       * 0.20 +
    rateScore         * 0.15 +
    hesScore          * 0.20 +
    completenessScore * 0.15 +
    confidenceScore   * 0.30
  ) + positionBonus;
}

function detectTakes(segments: TranscriptSegment[], totalDuration: number): Take[] {
  if (!segments.length) return [];

  // ── Tentative mot-à-mot (WhisperX) ────────────────────────────────────────
  // Les gaps entre mots consécutifs sont beaucoup plus fins que les gaps entre segments.
  // Whisper fusionne souvent un fumble + la vraie prise dans un seul segment, donc
  // la détection segment-level rate cette frontière.
  const allWords = segments.flatMap(s => s.words ?? []).filter(w => w.start != null && w.end != null);
  if (allWords.length >= 2) {
    const wordGroups: Word[][] = [];
    let cur: Word[] = [allWords[0]];
    for (let i = 1; i < allWords.length; i++) {
      // effectiveEnd plafonne la durée du mot précédent pour neutraliser l'inflation Whisper
      const prevEffectiveEnd = Math.min(allWords[i - 1].end, allWords[i - 1].start + MAX_WORD_DURATION_S);
      if (allWords[i].start - prevEffectiveEnd >= TAKE_GAP_S) {
        wordGroups.push(cur);
        cur = [allWords[i]];
      } else {
        cur.push(allWords[i]);
      }
    }
    wordGroups.push(cur);

    if (wordGroups.length > 1) {
      return wordGroups.map((group, idx) => {
        const rawStart = group[0].start;
        // Cap du dernier mot pour que le groupe ne déborde pas sur la pause suivante
        const rawEnd = Math.min(group[group.length - 1].end, group[group.length - 1].start + MAX_WORD_DURATION_S);
        const start = Math.max(0, rawStart - TAKE_PAD_S);
        const end = Math.min(totalDuration > 0 ? totalDuration : rawEnd + 1, rawEnd + TAKE_PAD_S);
        const text = group.map(w => w.word).join(" ").trim();
        const avgConfidence = group.reduce((s, w) => s + (w.score ?? 0.8), 0) / group.length;
        const score = scoreGroup(text, group.length, rawStart, rawEnd, avgConfidence, idx, wordGroups.length);
        const matchedSegs = segments.filter(s => s.end >= rawStart && s.start <= rawEnd);
        return {
          index: idx + 1,
          segments: matchedSegs.length ? matchedSegs : [{ text, start: rawStart, end: rawEnd }],
          start, end, score, text,
        };
      });
    }
  }

  // ── Fallback : gaps entre segments ────────────────────────────────────────
  const segGroups: TranscriptSegment[][] = [];
  let curSeg: TranscriptSegment[] = [segments[0]];
  for (let i = 1; i < segments.length; i++) {
    if (segments[i].start - segments[i - 1].end >= TAKE_GAP_S) {
      segGroups.push(curSeg);
      curSeg = [segments[i]];
    } else {
      curSeg.push(segments[i]);
    }
  }
  segGroups.push(curSeg);
  if (segGroups.length <= 1) return [];

  return segGroups.map((group, idx) => {
    const rawStart = group[0].start;
    const rawEnd = group[group.length - 1].end;
    const start = Math.max(0, rawStart - TAKE_PAD_S);
    const end = Math.min(totalDuration > 0 ? totalDuration : rawEnd + 1, rawEnd + TAKE_PAD_S);
    const text = group.map(s => s.text).join(" ").trim();
    const words = text.split(/\s+/).filter(Boolean);
    const segWords = group.flatMap(s => s.words ?? []);
    const avgConfidence = segWords.length
      ? segWords.reduce((s, w) => s + (w.score ?? 0.8), 0) / segWords.length
      : 0.8;
    const score = scoreGroup(text, words.length, rawStart, rawEnd, avgConfidence, idx, segGroups.length);
    return { index: idx + 1, segments: group, start, end, score, text };
  });
}

// ── Lecteur vidéo contraint entre trimStart et trimEnd ────────────────────────
interface TrimPlayerProps {
  trimStart: number;
  trimEnd: number;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Timestamp (absolu) de fin du dernier mot Whisper — affiché comme marqueur sur le scrubber. */
  lastWordEnd?: number | null;
  /** Mode rush complet : joue sur [0, fullDuration], affiche zone cut en overlay */
  fullRush?: boolean;
  /** Durée totale du fichier (utilisée en mode fullRush) */
  fullDuration?: number;
  /** Timecodes du cut — affichés comme zone indigo + traits sur le scrubber en mode fullRush */
  cutStart?: number;
  cutEnd?: number;
}

function TrimPlayer({ trimStart, trimEnd, videoRef, lastWordEnd, fullRush = false, fullDuration, cutStart, cutEnd }: TrimPlayerProps) {
  // En mode fullRush, le player joue sur [0, fullDuration] sans contrainte
  const effectiveStart = fullRush ? 0 : trimStart;
  const effectiveEnd = fullRush ? (fullDuration ?? trimEnd) : trimEnd;
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(trimStart);
  const scrubBarRef = useRef<HTMLDivElement>(null);
  const rafIdRef = useRef<number>(0);

  // Refs pour accéder aux valeurs courantes dans les event listeners sans stale closure
  const trimStartRef = useRef(trimStart);
  const trimEndRef = useRef(trimEnd);
  useEffect(() => { trimStartRef.current = fullRush ? 0 : trimStart; }, [trimStart, fullRush]);
  useEffect(() => { trimEndRef.current = fullRush ? (fullDuration ?? trimEnd) : trimEnd; }, [trimEnd, fullRush, fullDuration]);

  // Seek au nouveau trimStart quand il change (sauf en mode fullRush)
  useEffect(() => {
    const v = videoRef.current;
    if (!v || fullRush) return;
    if (!isPlaying) {
      try { v.currentTime = trimStart; } catch { /* ok */ }
      setCurrentTime(trimStart);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimStart, fullRush]);

  // Quand trimEnd change en cours de lecture, la contrainte sera appliquée par timeupdate

  // Montage : seek initial + RAF loop pendant la lecture.
  // requestAnimationFrame (~16ms) remplace timeupdate (~250ms) pour stopper
  // précisément à trimEnd sans laisser la vidéo déborder.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const handleLoaded = () => {
      try { v.currentTime = trimStartRef.current; } catch { /* ok */ }
      setCurrentTime(trimStartRef.current);
    };

    const tick = () => {
      const ct = v.currentTime;
      const end = trimEndRef.current;
      const start = trimStartRef.current;
      if (ct >= end) {
        v.pause();
        try { v.currentTime = end; } catch { /* ok */ }
        setIsPlaying(false);
        setCurrentTime(end);
        return; // pas de RAF suivant → boucle stoppée
      }
      if (ct < start) {
        try { v.currentTime = start; } catch { /* ok */ }
      }
      setCurrentTime(ct);
      rafIdRef.current = requestAnimationFrame(tick);
    };

    const handlePlay = () => {
      setIsPlaying(true);
      rafIdRef.current = requestAnimationFrame(tick);
    };
    const handlePause = () => {
      setIsPlaying(false);
      cancelAnimationFrame(rafIdRef.current);
      setCurrentTime(v.currentTime);
    };
    const handleEnded = () => {
      setIsPlaying(false);
      cancelAnimationFrame(rafIdRef.current);
      setCurrentTime(trimStartRef.current);
    };

    if (v.readyState >= 1) handleLoaded();
    else v.addEventListener("loadedmetadata", handleLoaded, { once: true });

    v.addEventListener("play", handlePlay);
    v.addEventListener("pause", handlePause);
    v.addEventListener("ended", handleEnded);

    return () => {
      cancelAnimationFrame(rafIdRef.current);
      v.removeEventListener("play", handlePlay);
      v.removeEventListener("pause", handlePause);
      v.removeEventListener("ended", handleEnded);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (isPlaying) { v.pause(); return; }
    const ct = v.currentTime;
    if (ct < effectiveStart || ct >= effectiveEnd) {
      try { v.currentTime = effectiveStart; } catch { /* ok */ }
    }
    void v.play();
  }, [isPlaying, effectiveStart, effectiveEnd, videoRef]);

  const seekToStart = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    try { v.currentTime = effectiveStart; } catch { /* ok */ }
    setCurrentTime(effectiveStart);
  }, [effectiveStart, videoRef]);

  const seekToEnd = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const t = Math.max(effectiveStart, effectiveEnd - 0.04);
    try { v.currentTime = t; } catch { /* ok */ }
    setCurrentTime(t);
  }, [effectiveStart, effectiveEnd, videoRef]);

  // Scrubber : clic ou drag pour seeker dans [trimStart, trimEnd]
  const handleScrubClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const bar = scrubBarRef.current;
    const v = videoRef.current;
    if (!bar || !v) return;
    const rect = bar.getBoundingClientRect();
    const ratio = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const target = effectiveStart + ratio * (effectiveEnd - effectiveStart);
    try { v.currentTime = target; } catch { /* ok */ }
    setCurrentTime(target);
  }, [effectiveStart, effectiveEnd, videoRef]);

  const trimDuration = effectiveEnd - effectiveStart;
  const progress = trimDuration > 0 ? clamp((currentTime - effectiveStart) / trimDuration, 0, 1) : 0;

  return (
    <div className="flex flex-col gap-2">

      {/* Barre de progression — zone de clic élargie pour faciliter le scrub */}
      <div className="py-1.5 cursor-pointer" onClick={handleScrubClick}>
        <div ref={scrubBarRef} className="relative h-3 bg-gray-100 rounded-full">
          <div
            className="absolute inset-y-0 left-0 bg-indigo-400 rounded-full"
            style={{ width: `${progress * 100}%` }}
          />
        {/* Zone du cut en mode rush complet */}
        {fullRush && cutStart != null && cutEnd != null && trimDuration > 0 && (
          <div
            className="absolute inset-y-0 bg-indigo-200/50 pointer-events-none rounded-sm"
            style={{
              left: `${((cutStart - effectiveStart) / trimDuration) * 100}%`,
              width: `${((cutEnd - cutStart) / trimDuration) * 100}%`,
            }}
          />
        )}
        {fullRush && cutStart != null && trimDuration > 0 && (
          <div
            className="absolute inset-y-0 w-0.5 bg-green-500 pointer-events-none"
            style={{ left: `${((cutStart - effectiveStart) / trimDuration) * 100}%` }}
            title={`Début cut : ${fmt(cutStart)}`}
          />
        )}
        {fullRush && cutEnd != null && trimDuration > 0 && (
          <div
            className="absolute inset-y-0 w-0.5 bg-red-400 pointer-events-none"
            style={{ left: `${((cutEnd - effectiveStart) / trimDuration) * 100}%` }}
            title={`Fin cut : ${fmt(cutEnd)}`}
          />
        )}
        {/* Marqueur "dernier mot" — la zone après ce trait est le padding Whisper (~0.2s).
             Ne pas couper avant ce marqueur pour éviter de tronquer la parole. */}
        {lastWordEnd != null && lastWordEnd > effectiveStart && lastWordEnd < effectiveEnd && (
          <div
            className="absolute inset-y-0 w-0.5 bg-amber-400 rounded-full opacity-90 pointer-events-none"
            style={{ left: `${((lastWordEnd - effectiveStart) / trimDuration) * 100}%` }}
            title={`Dernier mot : +${fmt(lastWordEnd - effectiveStart)} (${fmt(lastWordEnd)})`}
          />
        )}
          {/* Curseur */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white border-2 border-indigo-500 rounded-full shadow-sm"
            style={{ left: `calc(${progress * 100}% - 7px)` }}
          />
        </div>
      </div>

      {/* Contrôles */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={togglePlay}
          className="flex items-center justify-center w-8 h-8 rounded-full bg-indigo-600 text-white hover:bg-indigo-700 flex-shrink-0 transition-colors"
        >
          {isPlaying ? <Pause size={13} /> : <Play size={13} />}
        </button>
        <span className="text-xs text-gray-500 tabular-nums flex-1 pl-0.5">
          {fmt(currentTime)}
          <span className="text-gray-300 mx-1">/</span>
          {fmt(trimDuration)}
        </span>
        <button
          onClick={seekToStart}
          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
          title="Aller au début du cut"
        >
          <SkipBack size={14} />
        </button>
        <button
          onClick={seekToEnd}
          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
          title="Aller à la fin du cut"
        >
          <SkipForward size={14} />
        </button>
      </div>
      {/* Légende: fin de parole détectée par Whisper */}
      {!fullRush && lastWordEnd != null && lastWordEnd > effectiveStart && lastWordEnd < effectiveEnd && (
        <div className="flex items-center gap-1.5 text-xs text-amber-500">
          <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
          Fin de parole détectée
        </div>
      )}
    </div>
  );
}

// ── Carte principale ──────────────────────────────────────────────────────────
export function AutocutReviewCard({ job, onAccept, onSkip }: Props) {
  const { asset } = job;
  const duration = asset.duration ?? 0;

  // Analyser le transcript pour détecter les prises avant les useState
  const { takes, transcript, lastWordEnd } = useMemo(() => {
    if (!job.transcriptJson) return { takes: [] as Take[], transcript: null, lastWordEnd: null as number | null };
    try {
      const segs = JSON.parse(job.transcriptJson) as TranscriptSegment[];
      // Même plafond que detectTakes : évite que le marker pointe sur le silence post-dernier-mot
      const wordEnds = segs.flatMap(s => s.words ?? []).map(w => Math.min(w.end, w.start + MAX_WORD_DURATION_S));
      const lastWordEnd: number | null = wordEnds.length ? Math.max(...wordEnds) : null;
      return { takes: detectTakes(segs, duration), transcript: segs, lastWordEnd };
    } catch { return { takes: [] as Take[], transcript: null, lastWordEnd: null as number | null }; }
  }, [job.transcriptJson, duration]);
  // Meilleure prise = score le plus élevé
  const bestIdx = takes.length > 1
    ? takes.reduce((b, t, i) => t.score > takes[b].score ? i : b, 0)
    : 0;

  // Quand plusieurs prises sont détectées : toujours pré-sélectionner les bornes de la
  // meilleure prise, même si confirmedStart/End sont non-null.
  // Raison : le webhook pré-remplit systématiquement confirmedStart/End depuis proposedStart/End
  // (= première/dernière syllabe de toute la vidéo, fumbles inclus). Utiliser ces valeurs
  // quand des prises existent donnerait un état incohérent : chip sélectionnée ≠ timecodes.
  const initStart = takes.length > 1
    ? takes[bestIdx].start
    : (job.confirmedStart ?? job.proposedStart ?? 0);
  const initEnd = takes.length > 1
    ? takes[bestIdx].end
    : (job.confirmedEnd ?? job.proposedEnd ?? duration);

  const [trimStart, setTrimStart] = useState(initStart);
  const [trimEnd, setTrimEnd] = useState(initEnd);
  const [startInput, setStartInput] = useState(initStart.toFixed(2));
  const [endInput, setEndInput] = useState(initEnd.toFixed(2));
  const [saving, setSaving] = useState(false);
  const [selectedTakeIndex, setSelectedTakeIndex] = useState(takes.length > 1 ? bestIdx : 0);
  const [showFullRush, setShowFullRush] = useState(false);

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
      {/* Filename + toggle rush */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-900 truncate max-w-sm">{asset.filename}</span>
        <div className="flex items-center gap-2 flex-shrink-0">
          {duration > 0 && <span className="text-xs text-gray-400">{fmt(duration)}</span>}
          <button
            onClick={() => setShowFullRush(v => !v)}
            className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded border transition-colors ${
              showFullRush
                ? "bg-indigo-50 text-indigo-600 border-indigo-200"
                : "text-gray-400 border-gray-200 hover:text-gray-600 hover:border-gray-300"
            }`}
            title={showFullRush ? "Revenir au mode coupé" : "Voir le rush complet"}
          >
            {showFullRush ? <Shrink size={11} /> : <Expand size={11} />}
            {showFullRush ? "Rush coupé" : "Rush complet"}
          </button>
        </div>
      </div>

      <div className="p-4">
        <div className="flex gap-4 items-start">
          {/* Colonne gauche : vidéo portrait + scrubber + contrôles */}
          <div className="w-44 shrink-0 flex flex-col gap-2">
            {/* aspect-[9/16] réserve la hauteur immédiatement sans attendre les métadonnées
                → overflow-hidden de la card ne clippe plus TrimPlayer par accident */}
            <div className="relative rounded-lg overflow-hidden bg-gray-900 aspect-[9/16]">
              <video ref={videoRef} src={asset.url} className="absolute inset-0 w-full h-full object-contain" preload="metadata" />
            </div>
            <TrimPlayer
              trimStart={trimStart}
              trimEnd={trimEnd}
              videoRef={videoRef}
              lastWordEnd={lastWordEnd}
              fullRush={showFullRush}
              fullDuration={duration > 0 ? duration : undefined}
              cutStart={trimStart}
              cutEnd={trimEnd}
            />
          </div>

          {/* Colonne droite : prises, transcript, réglages */}
          <div className="flex-1 min-w-0 flex flex-col gap-3">
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
          <div className="flex items-end gap-3 pt-1">
            {/* Début */}
            <div className="flex flex-col gap-1">
              <span className="text-xs text-gray-400 font-medium">Début (s)</span>
              <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden bg-white">
                <button
                  className="px-2.5 py-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 border-r border-gray-200 transition-colors text-base font-semibold leading-none"
                  onClick={() => applyStart(trimStart - 0.04)}
                  title="− 1 image (0.04 s)"
                >−</button>
                <input
                  type="number" step="0.01" value={startInput}
                  onChange={(e) => setStartInput(e.target.value)}
                  onBlur={() => { const v = parseFloat(startInput); if (!isNaN(v)) applyStart(v); else setStartInput(trimStart.toFixed(2)); }}
                  className="w-16 text-center text-sm py-1.5 focus:outline-none focus:bg-indigo-50 transition-colors"
                />
                <button
                  className="px-2.5 py-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 border-l border-gray-200 transition-colors text-base font-semibold leading-none"
                  onClick={() => applyStart(trimStart + 0.04)}
                  title="+ 1 image (0.04 s)"
                >+</button>
              </div>
            </div>

            <span className="text-gray-300 mt-4 text-sm">→</span>

            {/* Fin */}
            <div className="flex flex-col gap-1">
              <span className="text-xs text-gray-400 font-medium">Fin (s)</span>
              <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden bg-white">
                <button
                  className="px-2.5 py-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 border-r border-gray-200 transition-colors text-base font-semibold leading-none"
                  onClick={() => applyEnd(trimEnd - 0.04)}
                  title="− 1 image (0.04 s)"
                >−</button>
                <input
                  type="number" step="0.01" value={endInput}
                  onChange={(e) => setEndInput(e.target.value)}
                  onBlur={() => { const v = parseFloat(endInput); if (!isNaN(v)) applyEnd(v); else setEndInput(trimEnd.toFixed(2)); }}
                  className="w-16 text-center text-sm py-1.5 focus:outline-none focus:bg-indigo-50 transition-colors"
                />
                <button
                  className="px-2.5 py-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 border-l border-gray-200 transition-colors text-base font-semibold leading-none"
                  onClick={() => applyEnd(trimEnd + 0.04)}
                  title="+ 1 image (0.04 s)"
                >+</button>
              </div>
            </div>

            {/* Durée */}
            <div className="flex flex-col gap-1 ml-auto">
              <span className="text-xs text-gray-400 font-medium">Durée</span>
              <div className="flex items-center h-[38px] px-3 bg-indigo-50 rounded-lg border border-indigo-100">
                <span className="text-sm font-semibold text-indigo-600 tabular-nums">{fmt(Math.max(0, trimEnd - trimStart))}</span>
              </div>
            </div>
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
