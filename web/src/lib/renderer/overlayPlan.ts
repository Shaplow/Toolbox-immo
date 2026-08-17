import type { AnyBlock } from "@/types/template";
import { resolveBlockTimingRefs, type TimingRef } from "@/lib/videoSequenceUtils";

export interface SegmentMeta {
  /** Index into the unique overlay states array (= position in overlay_paths list). */
  index: number;
  /**
   * Bornes en secondes. Une borne négative `-v` est ancrée fin de clip
   * (= durée − v) et est résolue côté render engine une fois la durée connue
   * (`resolve_overlay_segments`, render-engine/engine/template_composite.py).
   */
  start: number;
  end: number | null;
}

export interface OverlayPlan {
  /** Unique overlay states: each entry lists the block IDs to hide when rendering that PNG. */
  states: { hiddenBlockIds: string[] }[];
  segments: SegmentMeta[];
}

/**
 * Comparateur de bornes symboliques sous l'hypothèse « clip assez long » :
 * toute borne ancrée début précède toute borne ancrée fin ; entre bornes fin,
 * l'ordre temporel est `durée − v` croissant, donc v décroissant.
 *
 * Limite inhérente : si le clip réel est plus court que l'hypothèse, l'ordre
 * réel peut différer (ex. `appearAt=5` vs `fin−3` sur un clip de 6 s). Les PNG
 * d'états étant figés avant de connaître la durée, le render engine dégrade en
 * clampant les fenêtres (monotonie forcée), jamais en inventant un état absent.
 */
function cmpSym(a: TimingRef, b: TimingRef): number {
  if (a.anchor === b.anchor) {
    return a.anchor === "start" ? a.value - b.value : b.value - a.value;
  }
  return a.anchor === "start" ? -1 : 1;
}

const ZERO: TimingRef = { anchor: "start", value: 0 };

/** Sérialise une borne symbolique pour `overlay_segments` (fin → float négatif). */
function toNumber(ref: TimingRef): number {
  return ref.anchor === "start" ? ref.value : -ref.value;
}

/**
 * Bornes effectives d'un bloc, assainies pour le plan :
 * - appear ancré fin avec valeur ≤ 0 → bloc jamais visible (fenêtre dégénérée) ;
 * - hide ancré fin avec valeur ≤ 0 → équivalent « jusqu'à la fin » (null).
 * (Double ceinture avec la normalisation, qui interdit déjà ces valeurs.)
 */
function effectiveRefs(
  block: AnyBlock,
  slotId?: string,
): { appear: TimingRef | null; hide: TimingRef | null; neverVisible: boolean } {
  const { appear, hide } = resolveBlockTimingRefs(block, slotId);
  const neverVisible = appear?.anchor === "end" && appear.value <= 0;
  const saneHide = hide?.anchor === "end" && hide.value <= 0 ? null : hide;
  return { appear, hide: saneHide, neverVisible };
}

/**
 * Computes a timed overlay plan from template blocks.
 *
 * When `slotId` is provided, per-slot timing overrides (`block.slotTimings[slotId]`)
 * take priority over the global `appearAt`/`hideAt` fields.
 *
 * Returns `null` when no block has timing fields → single-overlay fast path,
 * 100% backward compatible with existing behaviour.
 */
export function computeOverlayPlan(blocks: AnyBlock[], slotId?: string): OverlayPlan | null {
  const hasAnyTiming = blocks.some((b) => {
    const { appear, hide } = effectiveRefs(b, slotId);
    return (appear !== null && (appear.anchor === "end" || appear.value > 0)) || hide !== null;
  });
  if (!hasAnyTiming) return null;

  // Collect all symbolic time breakpoints (deduplicated by anchor+value)
  const bpMap = new Map<string, TimingRef>([["start:0", ZERO]]);
  const addBp = (ref: TimingRef) => bpMap.set(`${ref.anchor}:${ref.value}`, ref);
  for (const b of blocks) {
    const { appear, hide, neverVisible } = effectiveRefs(b, slotId);
    if (neverVisible) continue;
    if (appear !== null && (appear.anchor === "end" || appear.value > 0)) addBp(appear);
    if (hide !== null) addBp(hide);
  }
  const breakpoints = Array.from(bpMap.values()).sort(cmpSym);

  // For each interval, determine which blocks are hidden
  const intervals: { start: TimingRef; end: TimingRef | null; hiddenBlockIds: string[] }[] = [];
  for (let i = 0; i < breakpoints.length; i++) {
    const intervalStart = breakpoints[i];
    const intervalEnd = i + 1 < breakpoints.length ? breakpoints[i + 1] : null;
    const hidden = blocks
      .filter((b) => {
        const { appear, hide, neverVisible } = effectiveRefs(b, slotId);
        if (neverVisible) return true;
        const ap = appear ?? ZERO;
        return !(cmpSym(intervalStart, ap) >= 0 && (hide === null || cmpSym(intervalStart, hide) < 0));
      })
      .map((b) => b.id);
    intervals.push({ start: intervalStart, end: intervalEnd, hiddenBlockIds: hidden });
  }

  // Deduplicate identical visibility states
  const stateKey = (ids: string[]) => JSON.stringify([...ids].sort());
  const stateMap = new Map<string, number>();
  const states: { hiddenBlockIds: string[] }[] = [];
  const rawSegments: SegmentMeta[] = [];

  for (const interval of intervals) {
    const key = stateKey(interval.hiddenBlockIds);
    let idx = stateMap.get(key);
    if (idx === undefined) {
      idx = states.length;
      states.push({ hiddenBlockIds: interval.hiddenBlockIds });
      stateMap.set(key, idx);
    }
    rawSegments.push({
      index: idx,
      start: toNumber(interval.start),
      end: interval.end === null ? null : toNumber(interval.end),
    });
  }

  // Merge consecutive segments that share the same overlay index
  const segments: SegmentMeta[] = [];
  for (const seg of rawSegments) {
    const last = segments[segments.length - 1];
    if (last && last.index === seg.index && last.end === seg.start) {
      segments[segments.length - 1] = { ...last, end: seg.end };
    } else {
      segments.push(seg);
    }
  }

  return { states, segments };
}
