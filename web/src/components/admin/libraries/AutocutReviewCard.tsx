"use client";

import { useState, useCallback, useMemo } from "react";
import { Check, X, Loader2, AlertTriangle, Expand, Shrink } from "lucide-react";
import { TrimPlayer } from "@/components/ui/molecules/TrimPlayer";
import { formatTimecode, round2 } from "@/lib/time";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Badge } from "@/components/ui/Badge";

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
  knownTags?: string[];
  onAccept: (jobId: string, confirmedStart: number, confirmedEnd: number, tags: string[]) => Promise<void>;
  onSkip: (jobId: string) => Promise<void>;
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

// ── Carte principale ──────────────────────────────────────────────────────────
export function AutocutReviewCard({ job, knownTags, onAccept, onSkip }: Props) {
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
  const [saving, setSaving] = useState(false);
  const [selectedTakeIndex, setSelectedTakeIndex] = useState(takes.length > 1 ? bestIdx : 0);
  const [showFullRush, setShowFullRush] = useState(false);
  const [pendingTags, setPendingTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  // Texte affiché : celui de la prise sélectionnée, ou full transcript si prise unique
  const transcriptText = takes.length > 1
    ? (takes[selectedTakeIndex]?.text ?? null)
    : (transcript?.map((s) => s.text).join(" ").trim() ?? null);

  const handleSelectTake = useCallback((idx: number) => {
    const take = takes[idx];
    if (!take) return;
    setSelectedTakeIndex(idx);
    // TrimPlayer re-seek automatiquement sur le nouveau trimStart (prop contrôlée).
    setTrimStart(round2(take.start));
    setTrimEnd(round2(take.end));
  }, [takes]);

  const handleAccept = async () => {
    // Commettre le texte libre non validé avant d'envoyer
    const finalTags = [...pendingTags];
    if (tagInput.trim() && !finalTags.includes(tagInput.trim())) {
      finalTags.push(tagInput.trim());
    }
    setSaving(true);
    try { await onAccept(job.id, trimStart, trimEnd, finalTags); }
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
      <div className="border border-border rounded-xl p-4 bg-card opacity-80">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-foreground font-medium truncate max-w-xs">{asset.filename}</span>
          <Badge variant={isDone ? "success" : isFailed ? "danger" : "warning"} className="flex-shrink-0">
            {isPending && <Loader2 size={9} className="animate-spin mr-0.5" />}
            {isDone ? "✓ Appliqué" : isFailed ? "✗ Erreur" : "En cours…"}
          </Badge>
        </div>
        {isDone && (
          <p className="mt-1 text-xs text-muted-foreground">
            {asset.filename} remplacé sur R2 · {job.confirmedStart !== null && job.confirmedEnd !== null ? `${formatTimecode(job.confirmedEnd - job.confirmedStart)} conservés` : ""}
          </p>
        )}
        {isFailed && job.errorMsg && (
          <p className="mt-1 text-xs text-danger-600 truncate">{job.errorMsg}</p>
        )}
      </div>
    );
  }

  return (
    <div className="border border-border rounded-xl bg-card">
      {/* Filename + toggle rush */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <span className="text-sm font-medium text-foreground truncate max-w-sm">{asset.filename}</span>
        <div className="flex items-center gap-2 flex-shrink-0">
          {duration > 0 && <span className="text-xs text-muted-foreground">{formatTimecode(duration)}</span>}
          <Chip
            icon={showFullRush ? Shrink : Expand}
            selected={showFullRush}
            onClick={() => setShowFullRush((v) => !v)}
            size="sm"
          >
            {showFullRush ? "Rush coupé" : "Rush complet"}
          </Chip>
        </div>
      </div>

      <div className="p-4">
        <div className="flex gap-4 items-start">
          {/* Colonne gauche : vidéo portrait + scrubber + contrôles.
              w-72 (au lieu de l'ancien w-44) : la primitive TrimPlayer partagée
              a une rangée de contrôles (timecodes + nudge) plus dense que
              l'ancien scrubber maison — trop de contenu pour 176px. */}
          <div className="w-72 shrink-0 flex flex-col gap-2">
            <TrimPlayer
              src={asset.url}
              aspect="9:16"
              fps={25}
              start={trimStart}
              end={trimEnd}
              onChange={(s, e) => { setTrimStart(s); setTrimEnd(e); }}
              constrainPlayback={!showFullRush}
              markers={lastWordEnd != null ? [{
                time: lastWordEnd,
                tone: "warning",
                label: `Dernier mot : ${formatTimecode(lastWordEnd)}`,
              }] : undefined}
            />
            {/* Légende : fin de parole détectée par Whisper */}
            {lastWordEnd != null && lastWordEnd > trimStart && lastWordEnd < trimEnd && (
              <div className="flex items-center gap-1.5 text-xs text-warning-700">
                <span className="w-2 h-2 rounded-full bg-warning-600 flex-shrink-0" />
                Fin de parole détectée
              </div>
            )}
          </div>

          {/* Colonne droite : prises, transcript, réglages */}
          <div className="flex-1 min-w-0 flex flex-col gap-3">
          {/* Sélecteur de prises si plusieurs détectées */}
          {takes.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap gap-1.5 items-center">
                <span className="text-xs text-muted-foreground font-medium mr-0.5">Prises :</span>
                {takes.map((take, idx) => {
                  const isSelected = idx === selectedTakeIndex;
                  const isBest = idx === bestIdx;
                  const scoreColor = take.score >= 70
                    ? "text-success-600"
                    : take.score >= 45
                    ? "text-warning-700"
                    : "text-danger-600";
                  return (
                    <Chip key={idx} selected={isSelected} onClick={() => handleSelectTake(idx)} size="sm">
                      <span className="inline-flex items-center gap-1">
                        <span>Prise {take.index}</span>
                        {isBest && <span className="text-warning-600">★</span>}
                        <span className={scoreColor}>{take.score}%</span>
                      </span>
                    </Chip>
                  );
                })}
              </div>
              {transcriptText && (
                <p className="text-xs text-muted-foreground italic line-clamp-2">&ldquo;{transcriptText}&rdquo;</p>
              )}
            </div>
          )}
          {takes.length <= 1 && transcriptText && (
            <p className="text-sm text-muted-foreground italic line-clamp-3">&ldquo;{transcriptText}&rdquo;</p>
          )}
          {!transcriptText && job.status === "done" && (
            <p className="text-xs text-muted-foreground italic">Pas de transcription disponible</p>
          )}
          {job.errorMsg && (
            <div className="flex items-center gap-1.5 text-xs text-danger-600">
              <AlertTriangle size={12} />
              <span className="truncate">{job.errorMsg}</span>
            </div>
          )}

          {/* Timing (début/fin/durée, nudge frame par frame) : géré par
              TrimPlayer dans la colonne gauche — plus de doublon d'inputs ici. */}

          {/* Tags */}
          <div className="flex flex-col gap-1.5 pt-0.5">
            <span className="text-xs text-muted-foreground font-medium">Tags</span>
            {(knownTags ?? []).length > 0 && (
              <div className="flex flex-wrap gap-1">
                {(knownTags ?? []).map((t) => {
                  const active = pendingTags.includes(t);
                  return (
                    <Chip
                      key={t}
                      size="sm"
                      selected={active}
                      onClick={() =>
                        setPendingTags((prev) =>
                          active ? prev.filter((x) => x !== t) : [...prev, t]
                        )
                      }
                    >
                      {t}
                    </Chip>
                  );
                })}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 min-h-[32px]">
              {pendingTags
                .filter((t) => !(knownTags ?? []).includes(t))
                .map((t) => (
                  <Chip
                    key={t}
                    size="sm"
                    onRemove={() => setPendingTags((prev) => prev.filter((x) => x !== t))}
                  >
                    {t}
                  </Chip>
                ))}
              <input
                type="text"
                placeholder={pendingTags.length === 0 ? "Tag personnalisé…" : ""}
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === ",") && tagInput.trim()) {
                    e.preventDefault();
                    const val = tagInput.trim().replace(/,\s*$/, "");
                    if (val && !pendingTags.includes(val))
                      setPendingTags((prev) => [...prev, val]);
                    setTagInput("");
                  }
                }}
                className="flex-1 min-w-[80px] text-xs focus:outline-none bg-transparent placeholder-muted-foreground/50"
              />
            </div>
          </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="px-4 py-3 border-t border-border flex items-center justify-between">
        <Button variant="outline" size="sm" icon={X} loading={saving} onClick={() => void handleSkip()}>
          Passer
        </Button>
        <Button size="sm" icon={Check} loading={saving} onClick={() => void handleAccept()}>
          Valider
        </Button>
      </div>
    </div>
  );
}
