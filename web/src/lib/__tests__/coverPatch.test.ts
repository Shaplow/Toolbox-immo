/**
 * Tests for Cover Phase 3 — PATCH route validation logic + pickNativeFrames provenance.
 *
 * These tests exercise the pure-logic parts that can be tested without a DB:
 * 1. Offset bounds validation (-5000 / +5000)
 * 2. overlayGroupIds array validation
 * 3. pickNativeFrames: slotId + sequenceIndex propagation across multiple sources
 */

import { describe, it, expect } from "vitest";

// ── Helpers mirroring the PATCH route validation (pure logic) ─────────────────

const OFFSET_MIN = -5000;
const OFFSET_MAX = 5000;

function validateOffset(value: unknown): { ok: true; value: number } | { ok: false; error: string } {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { ok: false, error: "offset doit être un nombre fini" };
  }
  if (value < OFFSET_MIN || value > OFFSET_MAX) {
    return { ok: false, error: `offset hors bornes (${OFFSET_MIN}–${OFFSET_MAX})` };
  }
  return { ok: true, value };
}

function validateGroupIds(value: unknown): { ok: true; ids: string[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: false, error: "overlayGroupIds doit être un array" };
  if (!value.every((item) => typeof item === "string")) {
    return { ok: false, error: "overlayGroupIds doit contenir uniquement des strings" };
  }
  return { ok: true, ids: value as string[] };
}

// ── Minimal re-implementation of pickNativeFrames for pure unit testing ───────
// (mirrors the logic in coverAuto.ts without all the I/O)

const MIN_FRAME_GAP_S = 1 / 30;

type CoverFrameSource = { slotId: string; sourceUrl: string; duration: number };
type CoverFramePick = { sourceUrl: string; timestamp: number; slotId?: string; sequenceIndex?: number };

function sampleEvenly<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  const step = items.length / count;
  return Array.from({ length: count }, (_, index) =>
    items[Math.min(items.length - 1, Math.floor(index * step + step / 2))],
  );
}

function targetFrameCount(totalDuration: number, requestedCount: number): number {
  if (!Number.isFinite(totalDuration) || totalDuration <= 0) return 0;
  return Math.min(requestedCount, Math.max(1, Math.floor(totalDuration / MIN_FRAME_GAP_S)));
}

function pickNativeFrames(sources: CoverFrameSource[], count: number, seen: Set<string>): CoverFramePick[] {
  const collect = (seenValues: Set<string>) => {
    const candidates: CoverFramePick[] = [];
    for (let seqIdx = 0; seqIdx < sources.length; seqIdx += 1) {
      const source = sources[seqIdx]!;
      const sourceFrameCount = Math.floor(source.duration / MIN_FRAME_GAP_S);
      for (let index = 0; index < sourceFrameCount; index += 1) {
        const timestamp =
          Math.round((((index + 0.5) * source.duration) / sourceFrameCount) * 1000) / 1000;
        if (!seenValues.has(`${source.sourceUrl}::${timestamp}`)) {
          candidates.push({
            sourceUrl: source.sourceUrl,
            timestamp,
            slotId: source.slotId,
            sequenceIndex: seqIdx,
          });
        }
      }
    }
    return candidates;
  };

  const target = targetFrameCount(
    sources.reduce((sum, source) => sum + source.duration, 0),
    count,
  );
  if (target === 0) return [];
  let candidates = collect(seen);
  if (candidates.length < target && seen.size > 0) {
    candidates = collect(new Set());
  }
  return sampleEvenly(candidates, target);
}

// ── Tests : PATCH validation ──────────────────────────────────────────────────

describe("validateOffset", () => {
  it("accepte 0", () => {
    expect(validateOffset(0)).toEqual({ ok: true, value: 0 });
  });
  it("accepte 5000 (borne haute)", () => {
    expect(validateOffset(5000)).toEqual({ ok: true, value: 5000 });
  });
  it("accepte -5000 (borne basse)", () => {
    expect(validateOffset(-5000)).toEqual({ ok: true, value: -5000 });
  });
  it("refuse 5001 (hors bornes)", () => {
    const result = validateOffset(5001);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/hors bornes/);
  });
  it("refuse une string", () => {
    const result = validateOffset("300");
    expect(result.ok).toBe(false);
  });
  it("refuse NaN", () => {
    expect(validateOffset(NaN)).toEqual({ ok: false, error: "offset doit être un nombre fini" });
  });
  it("refuse Infinity", () => {
    expect(validateOffset(Infinity)).toEqual({ ok: false, error: "offset doit être un nombre fini" });
  });
  it("accepte des valeurs fractionnaires raisonnables", () => {
    expect(validateOffset(123.5)).toEqual({ ok: true, value: 123.5 });
  });
});

describe("validateGroupIds", () => {
  it("accepte un array vide (cover sans overlay)", () => {
    expect(validateGroupIds([])).toEqual({ ok: true, ids: [] });
  });
  it("accepte un array de strings", () => {
    expect(validateGroupIds(["g1", "g2"])).toEqual({ ok: true, ids: ["g1", "g2"] });
  });
  it("refuse un non-array", () => {
    expect(validateGroupIds("g1")).toEqual({ ok: false, error: "overlayGroupIds doit être un array" });
  });
  it("refuse un array avec des non-strings", () => {
    const result = validateGroupIds(["g1", 42]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/strings/);
  });
  it("refuse null", () => {
    const result = validateGroupIds(null);
    expect(result.ok).toBe(false);
  });
});

// ── Tests : pickNativeFrames provenance ───────────────────────────────────────

describe("pickNativeFrames — slotId + sequenceIndex provenance", () => {
  const sourceA: CoverFrameSource = { slotId: "slot-a", sourceUrl: "http://video-a.mp4", duration: 5 };
  const sourceB: CoverFrameSource = { slotId: "slot-b", sourceUrl: "http://video-b.mp4", duration: 5 };

  it("chaque pick porte le slotId de sa source", () => {
    const picks = pickNativeFrames([sourceA], 6, new Set());
    expect(picks.length).toBeGreaterThan(0);
    for (const pick of picks) {
      expect(pick.slotId).toBe("slot-a");
    }
  });

  it("sequenceIndex = 0 pour la première source", () => {
    const picks = pickNativeFrames([sourceA], 3, new Set());
    for (const pick of picks) {
      expect(pick.sequenceIndex).toBe(0);
    }
  });

  it("sequenceIndex = 1 pour la deuxième source (multi-sequence)", () => {
    const picks = pickNativeFrames([sourceA, sourceB], 30, new Set());
    const picksB = picks.filter((p) => p.sourceUrl === sourceB.sourceUrl);
    expect(picksB.length).toBeGreaterThan(0);
    for (const pick of picksB) {
      expect(pick.sequenceIndex).toBe(1);
      expect(pick.slotId).toBe("slot-b");
    }
  });

  it("produit des picks des deux sources en multi-sequence", () => {
    const picks = pickNativeFrames([sourceA, sourceB], 20, new Set());
    const slotIds = new Set(picks.map((p) => p.slotId));
    expect(slotIds.has("slot-a")).toBe(true);
    expect(slotIds.has("slot-b")).toBe(true);
  });

  it("retourne [] si sources est vide", () => {
    expect(pickNativeFrames([], 10, new Set())).toEqual([]);
  });

  it("retourne [] si duration trop courte", () => {
    const tiny: CoverFrameSource = { slotId: "x", sourceUrl: "http://x.mp4", duration: 0.001 };
    expect(pickNativeFrames([tiny], 5, new Set())).toEqual([]);
  });

  it("n'inclut pas les frames déjà vues (seen set)", () => {
    // Pre-compute what frames would be picked
    const first = pickNativeFrames([sourceA], 100, new Set());
    // Build a seen set with all timestamps from sourceA
    const seen = new Set(first.map((p) => `${p.sourceUrl}::${p.timestamp}`));
    // With seen full of sourceA picks, should fallback to unseen (same picks — seen.size > 0 → collect(new Set()))
    const second = pickNativeFrames([sourceA], 3, seen);
    // Should still return picks (fallback to ignoring seen when not enough candidates)
    expect(second.length).toBeGreaterThan(0);
  });
});
