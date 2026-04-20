import { type Caption, normalizeWord } from "./srt";
import type { Segment, Word } from "./transcriptionProcess";

export type CaptionTimingStatus = "original" | "estimated" | "realigned";

type Match = {
  oldIndex: number;
  newIndex: number;
};

type RealignSegmentResult = {
  segment: Segment;
  matches: Match[];
  changed: boolean;
};

const TIMING_EPSILON = 0.0005;

function tokenizeCaptionText(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

function srtTimeToSeconds(t: string): number {
  const m = t.match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

function toSrtTime(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const h = Math.floor(safeSeconds / 3600);
  const m = Math.floor((safeSeconds % 3600) / 60);
  const s = Math.floor(safeSeconds % 60);
  const ms = Math.round((safeSeconds % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function cloneWord(word: Word): Word {
  return {
    word: word.word,
    start: word.start,
    end: word.end,
  };
}

function getSegmentWords(segment: Segment): Word[] {
  return Array.isArray(segment.words) ? segment.words : [];
}

function getLastWord(words: Word[]): Word | undefined {
  return words.length > 0 ? words[words.length - 1] : undefined;
}

function buildSyntheticWords(text: string, start: number, end: number): Word[] {
  const tokens = tokenizeCaptionText(text);
  if (tokens.length === 0) return [];

  const minDuration = 0.001 * tokens.length;
  const safeEnd = end > start ? end : start + minDuration;
  const totalDuration = Math.max(safeEnd - start, minDuration);
  const step = totalDuration / tokens.length;

  return tokens.map((word, index) => {
    const wordStart = start + step * index;
    const rawEnd = index === tokens.length - 1 ? start + totalDuration : start + step * (index + 1);
    return {
      word,
      start: wordStart,
      end: Math.max(rawEnd, wordStart + 0.0001),
    };
  });
}

function ensureTimedSegment(segment: Segment): Segment {
  const words = getSegmentWords(segment).length > 0
    ? getSegmentWords(segment).map(cloneWord)
    : buildSyntheticWords(segment.text, segment.start, segment.end);
  const firstWord = words[0];
  const lastWord = getLastWord(words);

  return {
    ...segment,
    start: firstWord?.start ?? segment.start,
    end: lastWord?.end ?? segment.end,
    words,
  };
}

function normalizeToken(token: string): string {
  return normalizeWord(token) || token.toLowerCase();
}

function areTokensEquivalent(oldWords: Word[], newTokens: string[]): boolean {
  if (oldWords.length !== newTokens.length) return false;

  return oldWords.every((word, index) => normalizeToken(word.word) === normalizeToken(newTokens[index]));
}

function didTimingWindowChange(segment: Segment, nextStart: number, nextEnd: number): boolean {
  return (
    Math.abs(segment.start - nextStart) > TIMING_EPSILON ||
    Math.abs(segment.end - nextEnd) > TIMING_EPSILON
  );
}

function computeLcsMatches(oldWords: Word[], newTokens: string[]): Match[] {
  const oldNormalized = oldWords.map((word) => normalizeToken(word.word));
  const newNormalized = newTokens.map((token) => normalizeToken(token));
  const dp = Array.from({ length: oldNormalized.length + 1 }, () => new Array<number>(newNormalized.length + 1).fill(0));

  for (let oldIndex = oldNormalized.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newNormalized.length - 1; newIndex >= 0; newIndex -= 1) {
      if (oldNormalized[oldIndex] !== "" && oldNormalized[oldIndex] === newNormalized[newIndex]) {
        dp[oldIndex][newIndex] = dp[oldIndex + 1][newIndex + 1] + 1;
      } else {
        dp[oldIndex][newIndex] = Math.max(dp[oldIndex + 1][newIndex], dp[oldIndex][newIndex + 1]);
      }
    }
  }

  const matches: Match[] = [];
  let oldIndex = 0;
  let newIndex = 0;

  while (oldIndex < oldNormalized.length && newIndex < newNormalized.length) {
    if (
      oldNormalized[oldIndex] !== "" &&
      oldNormalized[oldIndex] === newNormalized[newIndex] &&
      dp[oldIndex][newIndex] === dp[oldIndex + 1][newIndex + 1] + 1
    ) {
      matches.push({ oldIndex, newIndex });
      oldIndex += 1;
      newIndex += 1;
      continue;
    }

    if (dp[oldIndex + 1][newIndex] >= dp[oldIndex][newIndex + 1]) {
      oldIndex += 1;
    } else {
      newIndex += 1;
    }
  }

  return matches;
}

function remapTime(value: number, oldStart: number, oldEnd: number, newStart: number, newEnd: number): number {
  if (oldEnd <= oldStart) return newStart;
  const ratio = (value - oldStart) / (oldEnd - oldStart);
  return newStart + ratio * (newEnd - newStart);
}

function fillBoundarySuggestions(
  oldWords: Word[],
  newWordCount: number,
  matches: Match[],
  oldStart: number,
  oldEnd: number,
  newStart: number,
  newEnd: number,
): number[] {
  const suggestions = Array.from({ length: newWordCount + 1 }, () => [] as number[]);

  for (const match of matches) {
    const oldWord = oldWords[match.oldIndex];
    suggestions[match.newIndex].push(remapTime(oldWord.start, oldStart, oldEnd, newStart, newEnd));
    suggestions[match.newIndex + 1].push(remapTime(oldWord.end, oldStart, oldEnd, newStart, newEnd));
  }

  const desired: Array<number | null> = suggestions.map((values) => (values.length > 0 ? average(values) : null));
  const lastBoundaryIndex = newWordCount;

  if (desired[0] === null) desired[0] = newStart;
  if (desired[lastBoundaryIndex] === null) desired[lastBoundaryIndex] = newEnd;

  const filled = new Array<number>(newWordCount + 1);

  for (let boundaryIndex = 0; boundaryIndex <= newWordCount; boundaryIndex += 1) {
    const desiredBoundary = desired[boundaryIndex];
    if (desiredBoundary !== null) {
      filled[boundaryIndex] = desiredBoundary;
      continue;
    }

    let leftIndex = boundaryIndex - 1;
    while (leftIndex >= 0 && desired[leftIndex] === null) {
      leftIndex -= 1;
    }

    let rightIndex = boundaryIndex + 1;
    while (rightIndex <= newWordCount && desired[rightIndex] === null) {
      rightIndex += 1;
    }

    const leftDesired = leftIndex >= 0 ? desired[leftIndex] : null;
    const rightDesired = rightIndex <= newWordCount ? desired[rightIndex] : null;
    const leftValue = leftDesired !== null ? leftDesired : newStart;
    const rightValue = rightDesired !== null ? rightDesired : newEnd;
    const ratio = (boundaryIndex - leftIndex) / (rightIndex - leftIndex);
    filled[boundaryIndex] = leftValue + (rightValue - leftValue) * ratio;
  }

  const windowStart = filled[0];
  const windowEnd = Math.max(filled[lastBoundaryIndex], windowStart + 0.0001 * Math.max(newWordCount, 1));
  const windowDuration = Math.max(windowEnd - windowStart, 0.0001);
  const minStep = Math.min(0.001, windowDuration / Math.max(newWordCount * 4, 1));
  const normalized = new Array<number>(newWordCount + 1);

  normalized[0] = windowStart;
  for (let boundaryIndex = 1; boundaryIndex < lastBoundaryIndex; boundaryIndex += 1) {
    const minAllowed = normalized[boundaryIndex - 1] + minStep;
    const maxAllowed = windowEnd - (lastBoundaryIndex - boundaryIndex) * minStep;
    normalized[boundaryIndex] = clamp(filled[boundaryIndex], minAllowed, maxAllowed);
  }
  normalized[lastBoundaryIndex] = windowEnd;

  return normalized;
}

function realignSegment(
  segment: Segment,
  caption: Caption,
): RealignSegmentResult {
  const baseSegment = ensureTimedSegment(segment);
  const oldWords = getSegmentWords(baseSegment);
  const newTokens = tokenizeCaptionText(caption.text);
  const targetStart = srtTimeToSeconds(caption.start);
  const targetEnd = srtTimeToSeconds(caption.end);

  if (newTokens.length === 0) {
    return {
      segment: {
        ...baseSegment,
        start: targetStart,
        end: targetEnd,
        text: caption.text,
        words: [],
      },
      matches: [],
      changed: true,
    };
  }

  const safeTargetEnd = targetEnd > targetStart ? targetEnd : targetStart + 0.001 * newTokens.length;
  const matches = computeLcsMatches(oldWords, newTokens);
  const boundaries = fillBoundarySuggestions(
    oldWords,
    newTokens.length,
    matches,
    baseSegment.start,
    baseSegment.end,
    targetStart,
    safeTargetEnd,
  );
  const words = newTokens.map((word, index) => ({
    word,
    start: boundaries[index],
    end: boundaries[index + 1],
  }));
  const changed = !areTokensEquivalent(oldWords, newTokens) || didTimingWindowChange(baseSegment, targetStart, safeTargetEnd);

  return {
    segment: {
      ...baseSegment,
      start: words[0].start,
      end: words[words.length - 1].end,
      text: caption.text,
      words,
    },
    matches,
    changed,
  };
}

export function buildTimingStatuses(count: number, status: CaptionTimingStatus): CaptionTimingStatus[] {
  return Array.from({ length: count }, () => status);
}

export function buildTimedSegmentsFromCaptions(captions: Caption[]): Segment[] {
  return captions.map((caption) => {
    const start = srtTimeToSeconds(caption.start);
    const end = srtTimeToSeconds(caption.end);
    const words = buildSyntheticWords(caption.text, start, end);
    return {
      start: words[0]?.start ?? start,
      end: getLastWord(words)?.end ?? end,
      text: caption.text,
      words,
    };
  });
}

export function buildTimedSegmentsFromSegments(segments: Segment[]): Segment[] {
  return segments.map((segment) => ensureTimedSegment(segment));
}

export function timedSegmentsToCaptions(segments: Segment[]): Caption[] {
  return segments.map((segment, index) => {
    const words = getSegmentWords(segment);
    return {
      index: index + 1,
      start: toSrtTime(words[0]?.start ?? segment.start),
      end: toSrtTime(getLastWord(words)?.end ?? segment.end),
      text: segment.text,
    };
  });
}

export function realignTimedCaptions(
  previousSegments: Segment[] | null | undefined,
  nextCaptions: Caption[],
  previousHighlighted?: Map<string, number>,
  previousTimingStatuses?: CaptionTimingStatus[] | null,
): { segments: Segment[]; highlighted: Map<string, number>; timingStatuses: CaptionTimingStatus[] } {
  const segmentsSource = previousSegments && previousSegments.length === nextCaptions.length
    ? buildTimedSegmentsFromSegments(previousSegments)
    : buildTimedSegmentsFromCaptions(nextCaptions);
  const nextHighlighted = new Map<string, number>();
  const timingStatuses: CaptionTimingStatus[] = [];

  const segments = nextCaptions.map((caption, index) => {
    const fallbackSegment = buildTimedSegmentsFromCaptions([caption])[0];
    const sourceSegment = segmentsSource[index] ?? fallbackSegment;
    const realigned = realignSegment(sourceSegment, caption);
    const previousStatus = previousTimingStatuses?.[index] ?? (previousSegments ? "original" : "estimated");

    if (previousStatus === "original" && realigned.changed) {
      timingStatuses.push("realigned");
    } else if (previousStatus === "realigned") {
      timingStatuses.push("realigned");
    } else {
      timingStatuses.push(previousStatus);
    }

    if (previousHighlighted) {
      for (const match of realigned.matches) {
        const group = previousHighlighted.get(`${caption.index}-${match.oldIndex}`);
        if (group !== undefined) {
          nextHighlighted.set(`${caption.index}-${match.newIndex}`, group);
        }
      }
    }

    return realigned.segment;
  });

  return { segments, highlighted: nextHighlighted, timingStatuses };
}

export function buildWordTimestampsForSubmission(
  segments: Segment[],
  highlighted: Map<string, number>,
): string {
  const items: Array<{
    word: string;
    start: number;
    end: number;
    highlight: boolean;
    highlight_group: number;
    caption_index: number;
  }> = [];

  segments.forEach((segment, segmentIndex) => {
    const captionIndex = segmentIndex + 1;
    getSegmentWords(segment).forEach((word, wordIndex) => {
      const highlightGroup = highlighted.get(`${captionIndex}-${wordIndex}`);
      items.push({
        word: word.word,
        start: word.start,
        end: word.end,
        highlight: highlightGroup !== undefined,
        highlight_group: highlightGroup ?? 0,
        caption_index: captionIndex,
      });
    });
  });

  return JSON.stringify(items);
}