/**
 * Port TypeScript du module process.py (module externe transcription).
 *
 * Fonctions de post-traitement des segments de transcription bruts :
 *   - mergeSegments()       : fusion des micro-segments du même speaker
 *   - tagSegments()         : détection backstage / retake / banter / content
 *   - generateSrt()         : format SRT standard (output principal)
 *   - generateFullClean()   : texte structuré avec tags
 *   - generateContentOnly() : passages éditoriaux seuls
 *   - generateChunks()      : découpage ~9000 tokens avec overlap pour IA
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

export function mergeSegments(
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

export function tagSegments(segments: Segment[]): TaggedSegment[] {
  return segments.map((seg) => {
    const duration = seg.end - seg.start;
    const tag = tagSegment(seg.text, duration);
    return { ...seg, tag, duration };
  });
}

// ─── Génération SRT ───────────────────────────────────────────────────────────

export function generateSrt(segments: Segment[]): string {
  const lines: string[] = [];
  segments.forEach((seg, i) => {
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

function formatBlock(seg: TaggedSegment, showTag = false): string {
  const speaker = seg.speaker ?? "SPEAKER_?";
  const tag = showTag ? ` [${seg.tag}]` : "";
  return `[${fmtTs(seg.start)} → ${fmtTs(seg.end)}] ${speaker}${tag}\n${seg.text.trim()}`;
}

export function generateFullClean(segments: Segment[]): string {
  const tagged = tagSegments(mergeSegments(segments));
  return tagged.map((s) => formatBlock(s, true)).join("\n\n");
}

export function generateContentOnly(segments: Segment[]): string {
  const tagged = tagSegments(mergeSegments(segments));
  return tagged
    .filter((s) => s.tag === "CONTENT" || s.tag === "BANTER")
    .map((s) => formatBlock(s))
    .join("\n\n");
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
