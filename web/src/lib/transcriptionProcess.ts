/**
 * Port TypeScript du module process.py (module externe transcription).
 *
 * Fonctions de post-traitement des segments de transcription bruts :
 *   - generateSrt()         : format SRT standard (output principal)
 *   - generateChunks()      : découpage ~9000 tokens avec overlap pour IA
 *   - buildSubtitlesFromWords() : segmentation SRT par timestamps de mots
 *   - auditSRT()            : score et avertissements qualité SRT
 */

export interface Word {
  word: string;
  start: number;
  end: number;
}

export interface Segment {
  start: number;
  end: number;
  text: string;
  speaker?: string;
  words?: Word[];
  /// Code langue ISO de la passe gagnante (mode multi-langue uniquement).
  /// Absent en mode mono-langue.
  language?: string;
  /// Traduction du `text` vers la langue opposée (mode bilingue).
  /// Absent tant que /api/transcription/[id]/translate n'a pas été appelée.
  translation?: string;
}

export interface TaggedSegment extends Segment {
  tag: "CONTENT" | "BANTER" | "BACKSTAGE" | "RETAKE";
  duration: number;
}

export interface ChunkFile {
  filename: string;
  content: string;
}

// ─── Constantes (miroir de process.py) ────────────────────────────────────────

const MERGE_GAP           = 3.0;   // secondes entre segments pour fusion
const MAX_MERGED_DURATION = 90.0;  // durée max d'un bloc fusionné
const CHUNK_TARGET_TOKENS = 9000;
const CHUNK_OVERLAP_TOKENS = 800;

// ─── Constantes segmentation SRT ────────────────────────────────────────────

const SRT_MAX_CHARS_PER_LINE = 42;
const SRT_MAX_DURATION       = 4.0;
const SRT_MIN_DURATION       = 0.5;
const SRT_PAUSE_FORCE_CUT    = 0.5;
const SRT_PAUSE_SOFT_CUT     = 0.35;

const FRENCH_NON_CUT_AFTER = new Set([
  "de", "du", "des", "le", "la", "les", "l'", "\u2019l", "un", "une",
  "au", "aux", "en", "à", "a", "par", "pour", "avec", "sur", "sous",
  "ce", "cet", "cette", "ces", "mon", "ton", "son", "ma", "ta", "sa",
  "mes", "tes", "ses", "nos", "vos", "leur", "leurs",
  "dont", "que", "qu'", "qui", "se", "s'", "y", "ne", "n'",
]);

// ─── Constantes QA SRT ───────────────────────────────────────────────────────

const QA_MAX_DURATION_WARN  = 5.0;
const QA_MAX_DURATION_ERROR = 8.0;
const QA_MIN_DURATION       = 0.5;
const QA_CPS_WARN           = 22;
const QA_CPS_ERROR          = 28;
const QA_LINE_WARN          = 45;
const QA_LINE_ERROR         = 55;
const QA_GAP_LARGE          = 30.0;

export interface SRTWarning {
  type:
    | "TOO_LONG"
    | "TOO_SHORT"
    | "CPS_HIGH"
    | "LINE_TOO_LONG"
    | "TOO_MANY_LINES"
    | "OVERLAP"
    | "GAP_LARGE"
    | "REPEAT";
  index: number;
  value: number;
  threshold: number;
  severity: "error" | "warning" | "info";
}

// Patterns backstage en français
const BACKSTAGE_PATTERNS: RegExp[] = [
  /\bon (la |les |)refait\b/i,
  /\bon recoupe\b/i,
  /\bon coupe\b/i,
  /\bon tourne\b/i,
  /\bon (re)?démarre\b/i,
  /\bclap\b/i,
  /\btop départ\b/i,
  /\baction\s*[!.]*\s*$/i,
  /\bje recommence\b/i,
  /\bje reprends\b/i,
  /\bon reprend depuis\b/i,
  /\btest (micro|son|audio|caméra|cam)\b/i,
  /\bcadrage\b/i,
  /\blarsen\b/i,
  /\bfeedback\b/i,
  /\bon entend (rien|pas|pas bien)\b/i,
  /\b(micro|son|audio|cam) (est |qui )?(mort|coupé|pas bon|galère|décale)\b/i,
  /\brapproche[- ]?(toi|vous)\b/i,
  /\brecule[- ]?(toi|vous)?\b/i,
  /\btourne[- ]?(toi|vous)? (un peu|vers|face)\b/i,
  /\bregarde (la caméra|l'objectif|ici|là)\b/i,
  /\bparle (plus fort|moins fort|dans le micro|dans l'axe)\b/i,
  /^(ok|okay|ouais|oui|non)[.\s!]*$/i,
  /^(euh+|hmm+|mh+|hm+|pfff+)[.\s!]*$/i,
];

const BACKSTAGE_KEYWORDS = new Set([
  "on la refait", "on recoupe", "on coupe", "test micro", "test son",
  "test audio", "cadrage", "on tourne", "on redémarre", "on déroule",
  "clap", "top départ", "je recommence", "je reprends depuis",
  "parle plus fort", "parle moins fort", "dans le micro",
  "regarde la caméra", "regarde l'objectif",
  "rapproche-toi", "rapprochez-vous",
  "feedback", "larsen", "on entend rien",
]);

const RETAKE_KEYWORDS = new Set([
  "on la refait", "on recoupe", "on coupe", "on redémarre",
  "je recommence", "je reprends", "on reprend depuis",
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTs(seconds: number): string {
  const t = Math.max(0, Math.floor(seconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function srtTs(seconds: number): string {
  const ms = Math.round((seconds % 1) * 1000);
  return `${fmtTs(seconds)},${String(ms).padStart(3, "0")}`;
}

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[.,!?;:'"«»\u2019\u2018\u201c\u201d]+/g, "").trim();
}

function isDeterminer(word: string): boolean {
  return FRENCH_NON_CUT_AFTER.has(normalizeWord(word));
}

function wrapSubtitleText(text: string, maxPerLine = SRT_MAX_CHARS_PER_LINE): string {
  if (text.length <= maxPerLine) return text;
  const words = text.split(" ");
  if (words.length < 2) return text;
  const mid = Math.floor(text.length / 2);
  let bestIdx = -1;
  let bestDist = Infinity;
  let pos = 0;
  for (let i = 0; i < words.length - 1; i++) {
    pos += words[i].length + 1; // +1 for space
    const line1 = words.slice(0, i + 1).join(" ");
    const line2 = words.slice(i + 1).join(" ");
    if (line1.length > maxPerLine || line2.length > maxPerLine) continue;
    if (isDeterminer(words[i])) continue;
    const dist = Math.abs(pos - mid);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  if (bestIdx === -1) {
    // fallback: cut at last space before maxPerLine
    const cut = text.lastIndexOf(" ", maxPerLine);
    if (cut > 0) return text.slice(0, cut) + "\n" + text.slice(cut + 1);
    return text;
  }
  return words.slice(0, bestIdx + 1).join(" ") + "\n" + words.slice(bestIdx + 1).join(" ");
}

type WorkWord = Word & { speaker?: string };

function cleanWords(words: WorkWord[]): WorkWord[] {
  const HESITATION = /^(euh+|hm+|mh+|bah|pfff+|ah+|oh+|eh+)\.?$/i;
  // Pass 1: remove short isolated hesitations
  let result = words.filter((w, i) => {
    if (!HESITATION.test(w.word)) return true;
    const dur = w.end - w.start;
    const gapBefore = i > 0 ? w.start - words[i - 1].end : 999;
    const gapAfter  = i < words.length - 1 ? words[i + 1].start - w.end : 999;
    return !(dur < 0.35 && gapBefore < 0.4 && gapAfter < 0.4);
  });
  // Pass 2: remove immediate word repetitions (gap < 0.3s)
  result = result.filter((w, i) => {
    if (i === 0) return true;
    const prev = result[i - 1];
    return !(normalizeWord(w.word) === normalizeWord(prev.word) && w.start - prev.end < 0.3);
  });
  return result;
}

function isBackstage(text: string, duration: number): boolean {
  if (duration < 0.8) return true;

  const lower = text.trim().toLowerCase();
  const clean = lower.replace(/[.,!?;:«»"']+/g, "").trim();

  for (const kw of BACKSTAGE_KEYWORDS) {
    if (lower.includes(kw)) return true;
  }
  for (const pattern of BACKSTAGE_PATTERNS) {
    if (pattern.test(clean)) return true;
  }
  return false;
}

function tagSegment(text: string, duration: number): TaggedSegment["tag"] {
  if (isBackstage(text, duration)) {
    const lower = text.trim().toLowerCase();
    for (const kw of RETAKE_KEYWORDS) {
      if (lower.includes(kw)) return "RETAKE";
    }
    return "BACKSTAGE";
  }
  if (duration < 10 && text.trim().split(/\s+/).length <= 15) return "BANTER";
  return "CONTENT";
}

// ─── Étape 1 : fusion ─────────────────────────────────────────────────────────

function mergeSegments(
  segments: Segment[],
  mergeGap = MERGE_GAP,
  maxDuration = MAX_MERGED_DURATION,
): Segment[] {
  if (segments.length === 0) return [];

  const merged: Segment[] = [];
  let current = { ...segments[0] };

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const sameSpeaker = seg.speaker === current.speaker;
    const gap = seg.start - current.end;
    const mergedDuration = seg.end - current.start;

    if (sameSpeaker && gap <= mergeGap && mergedDuration <= maxDuration) {
      current = {
        ...current,
        end: seg.end,
        text: `${current.text.trimEnd()} ${seg.text.trimStart()}`,
      };
    } else {
      merged.push(current);
      current = { ...seg };
    }
  }
  merged.push(current);
  return merged;
}

// ─── Étape 2 : tagging ────────────────────────────────────────────────────────

function tagSegments(segments: Segment[]): TaggedSegment[] {
  return segments.map((seg) => {
    const duration = seg.end - seg.start;
    const tag = tagSegment(seg.text, duration);
    return { ...seg, tag, duration };
  });
}

// ─── Segmentation SRT par word timestamps ────────────────────────────────────

function findBestCutInBuffer(buffer: WorkWord[]): number {
  // If the last word already ends a sentence, accept the whole buffer as-is
  // rather than splitting off that word and creating a one-word orphan segment.
  if (/[.!?]$/.test(buffer[buffer.length - 1].word)) return buffer.length - 1;
  for (let j = buffer.length - 2; j >= 0; j--) {
    const gapAfter = buffer[j + 1].start - buffer[j].end;
    if (gapAfter >= SRT_PAUSE_SOFT_CUT) return j;
    if (/[.!?,]$/.test(buffer[j].word)) return j;
  }
  return -1;
}

function flushBuffer(buffer: WorkWord[]): Segment {
  const rawText = buffer.map((w) => w.word).join(" ");
  const text = wrapSubtitleText(rawText);
  const seg: Segment = {
    start: buffer[0].start,
    end: buffer[buffer.length - 1].end,
    text,
    words: buffer.map((w) => ({ word: w.word, start: w.start, end: w.end })),
  };
  const speaker = buffer[0].speaker;
  if (speaker) seg.speaker = speaker;
  return seg;
}

export function buildSubtitlesFromWords(segments: Segment[]): Segment[] {
  // 1. Flatten all word-level data from all segments
  const allWords: WorkWord[] = [];
  for (const seg of segments) {
    if (seg.words && seg.words.length > 0) {
      for (const w of seg.words) {
        allWords.push({ ...w, speaker: seg.speaker });
      }
    } else {
      // Segment without word timestamps: treat as a single synthetic word
      allWords.push({ word: seg.text.trim(), start: seg.start, end: seg.end, speaker: seg.speaker });
    }
  }

  if (allWords.length === 0) return segments;

  // Normalize word ends: Whisper assigns end = segment.end to the last word of
  // each segment, which can include long silences (e.g. 14 s for one word).
  // This causes realignSegment to produce heavily compressed timing windows
  // when the user recalés a timecode.  Cap each word's end to:
  //   - the next word's start (cross-segment), when the next word starts before
  //     the current word ends (handles overlap / inflated last-word ends)
  //   - word.start + 1 s absolute maximum (last word guard)
  const MAX_WORD_END_GAP = 1.0;
  for (let i = 0; i < allWords.length; i++) {
    const next = allWords[i + 1] ?? null;
    if (next && allWords[i].end > next.start) {
      allWords[i] = { ...allWords[i], end: next.start };
    }
    if (allWords[i].end > allWords[i].start + MAX_WORD_END_GAP) {
      allWords[i] = { ...allWords[i], end: allWords[i].start + MAX_WORD_END_GAP };
    }
  }

  const cleaned = cleanWords(allWords);
  const subtitles: Segment[] = [];
  let buffer: WorkWord[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const word = cleaned[i];
    buffer.push(word);

    const rawText = buffer.map((w) => w.word).join(" ");
    const duration = buffer[buffer.length - 1].end - buffer[0].start;
    const next = cleaned[i + 1] ?? null;
    const nextGap = next ? next.start - word.end : 999;

    // ── FORCED CUTS ────────────────────────────────────────────────────────
    // Bloc too wide (both lines would exceed maxPerLine)
    const wrapped = wrapSubtitleText(rawText);
    const maxLineLen = Math.max(...wrapped.split("\n").map((l) => l.length));
    if (maxLineLen > SRT_MAX_CHARS_PER_LINE && buffer.length > 1) {
      const lastWord = buffer.pop()!;
      subtitles.push(flushBuffer(buffer));
      buffer = [lastWord];
      continue;
    }

    // Duration exceeded
    if (duration > SRT_MAX_DURATION && buffer.length > 1) {
      const cutIdx = findBestCutInBuffer(buffer);
      if (cutIdx > 0) {
        subtitles.push(flushBuffer(buffer.slice(0, cutIdx + 1)));
        buffer = buffer.slice(cutIdx + 1);
      } else {
        const lastWord = buffer.pop()!;
        subtitles.push(flushBuffer(buffer));
        buffer = [lastWord];
      }
      continue;
    }

    // ── OPPORTUNISTIC CUTS ─────────────────────────────────────────────────
    // Long pause → natural break
    if (nextGap >= SRT_PAUSE_FORCE_CUT && buffer.length >= 2 && duration >= SRT_MIN_DURATION) {
      subtitles.push(flushBuffer(buffer));
      buffer = [];
      continue;
    }

    // End of sentence (.!?) + sufficient duration
    if (/[.!?]$/.test(word.word) && buffer.length >= 2 && duration >= SRT_MIN_DURATION) {
      subtitles.push(flushBuffer(buffer));
      buffer = [];
      continue;
    }

    // Comma + sufficient duration + enough chars + not ending on determiner
    if (
      word.word.endsWith(",") &&
      duration > 1.8 &&
      rawText.length > 18 &&
      buffer.length >= 3 &&
      !isDeterminer(buffer[buffer.length - 2]?.word ?? "")
    ) {
      subtitles.push(flushBuffer(buffer));
      buffer = [];
      continue;
    }

    // Soft pause + loaded buffer + not ending on determiner
    if (
      nextGap >= SRT_PAUSE_SOFT_CUT &&
      duration > 1.2 &&
      rawText.length > 20 &&
      !isDeterminer(word.word)
    ) {
      subtitles.push(flushBuffer(buffer));
      buffer = [];
    }
  }

  if (buffer.length > 0) subtitles.push(flushBuffer(buffer));

  // Post-pass: merge subtitles that are too short OR end on a dangling
  // article/determiner (e.g. "VENEZ JE VOUS LE") with the following segment.
  const merged: Segment[] = [];
  for (let i = 0; i < subtitles.length; i++) {
    const sub = subtitles[i];
    const dur = sub.end - sub.start;
    const subWords = sub.words ?? [];
    const lastWordOfSub = subWords[subWords.length - 1]?.word ?? sub.text.trim().split(/\s+/).pop() ?? "";
    const endsOnDeterminer = isDeterminer(lastWordOfSub);

    const shouldMerge =
      i < subtitles.length - 1 &&
      (dur < SRT_MIN_DURATION || endsOnDeterminer);

    if (shouldMerge) {
      const next = subtitles[i + 1];
      // Allow slightly over-duration merges when forced by a dangling determiner
      const maxAllowed = endsOnDeterminer ? SRT_MAX_DURATION * 1.5 : SRT_MAX_DURATION;
      const mergedDur = next.end - sub.start;
      if (mergedDur <= maxAllowed) {
        const rawMerged = sub.text.replace("\n", " ") + " " + next.text.replace("\n", " ");
        const mergedWords = [
          ...(sub.words ?? []),
          ...(next.words ?? []),
        ];
        merged.push({
          start: sub.start,
          end: next.end,
          text: wrapSubtitleText(rawMerged),
          speaker: sub.speaker,
          words: mergedWords.length > 0 ? mergedWords : undefined,
        });
        i++;
        continue;
      }
    }
    merged.push(sub);
  }

  return merged;
}

// ─── Génération SRT ───────────────────────────────────────────────────────────

export function generateSrt(segments: Segment[]): string {
  // Use word-level segmentation if data is available
  const hasWords = segments.some((s) => s.words && s.words.length > 0);
  const subtitles = hasWords ? buildSubtitlesFromWords(segments) : segments;

  const lines: string[] = [];
  subtitles.forEach((seg, i) => {
    const speaker = seg.speaker ? `[${seg.speaker}] ` : "";
    lines.push(
      `${i + 1}`,
      `${srtTs(seg.start)} --> ${srtTs(seg.end)}`,
      `${speaker}${seg.text.trim()}`,
      "",
    );
  });
  return lines.join("\n");
}

// ─── Génération texte structuré ───────────────────────────────────────────────

function formatBlock(seg: TaggedSegment): string {
  const speaker = seg.speaker ?? "SPEAKER_?";
  return `[${fmtTs(seg.start)} → ${fmtTs(seg.end)}] ${speaker}\n${seg.text.trim()}`;
}

// ─── Chunking IA ──────────────────────────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.max(1, Math.floor(text.length / 4));
}

export function generateChunks(
  segments: Segment[],
  targetTokens = CHUNK_TARGET_TOKENS,
  overlapTokens = CHUNK_OVERLAP_TOKENS,
  stem = "transcription",
): ChunkFile[] {
  const tagged = tagSegments(mergeSegments(segments));
  const content = tagged.filter((s) => s.tag === "CONTENT" || s.tag === "BANTER");

  if (content.length === 0) return [];

  const files: ChunkFile[] = [];
  let startIndex = 0;
  let chunkIdx = 1;

  while (startIndex < content.length) {
    const chunkSegs: TaggedSegment[] = [];
    let tokenCount = 0;
    let i = startIndex;

    while (i < content.length) {
      const block = formatBlock(content[i]);
      const t = estimateTokens(block);
      if (tokenCount + t > targetTokens && chunkSegs.length > 0) break;
      chunkSegs.push(content[i]);
      tokenCount += t;
      i++;
    }

    if (chunkSegs.length === 0) break;

    const realStart = chunkSegs[0].start;
    const realEnd   = chunkSegs[chunkSegs.length - 1].end;
    const wordCount = chunkSegs.reduce((acc, s) => acc + s.text.split(/\s+/).length, 0);

    const header = [
      `# CHUNK ${chunkIdx}  |  ${fmtTs(realStart)} → ${fmtTs(realEnd)}`,
      `#   ${chunkSegs.length} blocs  |  ~${wordCount} mots  |  ~${tokenCount} tokens`,
      `# Fichier source : ${stem}`,
      "=".repeat(70),
      "",
    ].join("\n");

    const body = chunkSegs.map((s) => formatBlock(s)).join("\n\n");
    const filename = `${stem}_chunk_${String(chunkIdx).padStart(2, "0")}.txt`;
    files.push({ filename, content: header + "\n" + body });

    // Calcul de l'overlap
    let overlapBudget = overlapTokens;
    let overlapCount = 0;
    for (let j = chunkSegs.length - 1; j >= 0; j--) {
      const t = estimateTokens(formatBlock(chunkSegs[j]));
      if (overlapBudget <= 0) break;
      overlapBudget -= t;
      overlapCount++;
    }

    const nextStart = i - overlapCount;
    startIndex = Math.max(nextStart, startIndex + 1);
    chunkIdx++;
  }

  return files;
}

// ─── Audit qualité SRT ───────────────────────────────────────────────────────

export function auditSRT(segments: Segment[]): SRTWarning[] {
  const subtitles = segments.some((s) => s.words && s.words.length > 0)
    ? buildSubtitlesFromWords(segments)
    : segments;

  const warnings: SRTWarning[] = [];

  for (let i = 0; i < subtitles.length; i++) {
    const sub = subtitles[i];
    const duration = sub.end - sub.start;
    const plainText = sub.text.replace(/\n/g, " ");
    const chars = plainText.length;
    const cps = chars / Math.max(0.1, duration);
    const lines = sub.text.split("\n");

    // Duration
    if (duration > QA_MAX_DURATION_ERROR) {
      warnings.push({ type: "TOO_LONG", index: i, value: duration, threshold: QA_MAX_DURATION_ERROR, severity: "error" });
    } else if (duration > QA_MAX_DURATION_WARN) {
      warnings.push({ type: "TOO_LONG", index: i, value: duration, threshold: QA_MAX_DURATION_WARN, severity: "warning" });
    }
    if (duration < QA_MIN_DURATION) {
      warnings.push({ type: "TOO_SHORT", index: i, value: duration, threshold: QA_MIN_DURATION, severity: "warning" });
    }

    // CPS
    if (cps > QA_CPS_ERROR) {
      warnings.push({ type: "CPS_HIGH", index: i, value: Math.round(cps), threshold: QA_CPS_ERROR, severity: "error" });
    } else if (cps > QA_CPS_WARN) {
      warnings.push({ type: "CPS_HIGH", index: i, value: Math.round(cps), threshold: QA_CPS_WARN, severity: "warning" });
    }

    // Line length
    for (const line of lines) {
      if (line.length > QA_LINE_ERROR) {
        warnings.push({ type: "LINE_TOO_LONG", index: i, value: line.length, threshold: QA_LINE_ERROR, severity: "error" });
      } else if (line.length > QA_LINE_WARN) {
        warnings.push({ type: "LINE_TOO_LONG", index: i, value: line.length, threshold: QA_LINE_WARN, severity: "warning" });
      }
    }

    // Too many lines
    if (lines.length > 2) {
      warnings.push({ type: "TOO_MANY_LINES", index: i, value: lines.length, threshold: 2, severity: "error" });
    }

    // Overlap with next
    const next = subtitles[i + 1];
    if (next && sub.end > next.start + 0.01) {
      warnings.push({ type: "OVERLAP", index: i, value: sub.end - next.start, threshold: 0, severity: "warning" });
    }

    // Large gap to next
    if (next && next.start - sub.end > QA_GAP_LARGE) {
      warnings.push({ type: "GAP_LARGE", index: i, value: next.start - sub.end, threshold: QA_GAP_LARGE, severity: "info" });
    }

    // Immediate word repetition
    const words = plainText.split(/\s+/);
    for (let j = 1; j < words.length; j++) {
      if (words[j].length > 2 && normalizeWord(words[j]) === normalizeWord(words[j - 1])) {
        warnings.push({ type: "REPEAT", index: i, value: j, threshold: 0, severity: "warning" });
        break;
      }
    }
  }

  return warnings;
}

export function srtQualityScore(warnings: SRTWarning[]): number {
  const errors   = warnings.filter((w) => w.severity === "error").length;
  const warnCount = warnings.filter((w) => w.severity === "warning").length;
  return Math.max(0, 100 - errors * 5 - warnCount * 2);
}
