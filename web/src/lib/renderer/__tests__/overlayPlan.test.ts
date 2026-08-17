import { describe, it, expect } from "vitest";
import { computeOverlayPlan } from "@/lib/renderer/overlayPlan";
import type { AnyBlock, TextBlock } from "@/types/template";

function mkBlock(id: string, overrides: Partial<TextBlock> = {}): AnyBlock {
  return {
    id,
    type: "text",
    x: 0,
    y: 0,
    w: 100,
    h: 40,
    z: 1,
    animations: [],
    text: id,
    ...overrides,
  } as TextBlock;
}

describe("computeOverlayPlan — régression (ancres début uniquement)", () => {
  it("aucun timing → null (fast path 1 PNG)", () => {
    expect(computeOverlayPlan([mkBlock("a"), mkBlock("b")])).toBeNull();
  });

  it("appearAt: 0 explicite sans autre timing → null", () => {
    expect(computeOverlayPlan([mkBlock("a", { appearAt: 0 })])).toBeNull();
  });

  it("timing début simple → segments identiques à l'existant", () => {
    const plan = computeOverlayPlan([mkBlock("a", { appearAt: 2, hideAt: 6 }), mkBlock("b")]);
    expect(plan).not.toBeNull();
    expect(plan!.states).toEqual([
      { hiddenBlockIds: ["a"] },
      { hiddenBlockIds: [] },
    ]);
    expect(plan!.segments).toEqual([
      { index: 0, start: 0, end: 2 },
      { index: 1, start: 2, end: 6 },
      { index: 0, start: 6, end: null },
    ]);
  });

  it("dédup d'états identiques + merge de segments consécutifs", () => {
    // a et b ont la même fenêtre → 2 états seulement
    const plan = computeOverlayPlan([
      mkBlock("a", { appearAt: 1, hideAt: 3 }),
      mkBlock("b", { appearAt: 1, hideAt: 3 }),
    ]);
    expect(plan!.states).toHaveLength(2);
    expect(plan!.segments).toEqual([
      { index: 0, start: 0, end: 1 },
      { index: 1, start: 1, end: 3 },
      { index: 0, start: 3, end: null },
    ]);
  });
});

describe("computeOverlayPlan — ancres fin", () => {
  it("appear ancré fin → visible sur les N dernières secondes (borne négative)", () => {
    const plan = computeOverlayPlan([
      mkBlock("a", { appearAt: 3, appearAnchor: "end" }),
      mkBlock("b"),
    ]);
    expect(plan!.states).toEqual([
      { hiddenBlockIds: ["a"] },
      { hiddenBlockIds: [] },
    ]);
    expect(plan!.segments).toEqual([
      { index: 0, start: 0, end: -3 },
      { index: 1, start: -3, end: null },
    ]);
  });

  it("hide ancré fin → masqué sur les N dernières secondes", () => {
    const plan = computeOverlayPlan([
      mkBlock("a", { hideAt: 3, hideAnchor: "end" }),
      mkBlock("b"),
    ]);
    expect(plan!.states).toEqual([
      { hiddenBlockIds: [] },
      { hiddenBlockIds: ["a"] },
    ]);
    expect(plan!.segments).toEqual([
      { index: 0, start: 0, end: -3 },
      { index: 1, start: -3, end: null },
    ]);
  });

  it("mélange début/fin → bornes début avant bornes fin", () => {
    const plan = computeOverlayPlan([
      mkBlock("a", { appearAt: 2 }),
      mkBlock("b", { appearAt: 3, appearAnchor: "end" }),
    ]);
    expect(plan!.segments).toEqual([
      { index: 0, start: 0, end: 2 },
      { index: 1, start: 2, end: -3 },
      { index: 2, start: -3, end: null },
    ]);
    expect(plan!.states).toEqual([
      { hiddenBlockIds: ["a", "b"] },
      { hiddenBlockIds: ["b"] },
      { hiddenBlockIds: [] },
    ]);
  });

  it("bornes fin multiples ordonnées par v décroissant (fin−5 avant fin−2)", () => {
    const plan = computeOverlayPlan([
      mkBlock("a", { appearAt: 5, appearAnchor: "end" }),
      mkBlock("b", { appearAt: 2, appearAnchor: "end" }),
    ]);
    expect(plan!.segments).toEqual([
      { index: 0, start: 0, end: -5 },
      { index: 1, start: -5, end: -2 },
      { index: 2, start: -2, end: null },
    ]);
    expect(plan!.states).toEqual([
      { hiddenBlockIds: ["a", "b"] },
      { hiddenBlockIds: ["b"] },
      { hiddenBlockIds: [] },
    ]);
  });

  it("fenêtre entièrement ancrée fin : visible de fin−5 à fin−2", () => {
    const plan = computeOverlayPlan([
      mkBlock("a", { appearAt: 5, appearAnchor: "end", hideAt: 2, hideAnchor: "end" }),
    ]);
    expect(plan!.segments).toEqual([
      { index: 0, start: 0, end: -5 },
      { index: 1, start: -5, end: -2 },
      { index: 0, start: -2, end: null },
    ]);
  });

  it("overrides slotTimings avec ancres (via slotId)", () => {
    const block = mkBlock("a", {
      appearAt: 1,
      slotTimings: { s1: { appearAt: 3, appearAnchor: "end" } },
    });
    const global = computeOverlayPlan([block]);
    expect(global!.segments[1]).toEqual({ index: 1, start: 1, end: null });
    const slotted = computeOverlayPlan([block], "s1");
    expect(slotted!.segments).toEqual([
      { index: 0, start: 0, end: -3 },
      { index: 1, start: -3, end: null },
    ]);
  });

  it("défensif : appear ancré fin valeur 0 → bloc jamais visible", () => {
    const plan = computeOverlayPlan([
      mkBlock("a", { appearAt: 0, appearAnchor: "end" }),
      mkBlock("b", { appearAt: 1 }),
    ]);
    for (const state of plan!.states) {
      expect(state.hiddenBlockIds).toContain("a");
    }
  });

  it("défensif : hide ancré fin valeur 0 seul → traité comme aucun timing", () => {
    expect(computeOverlayPlan([mkBlock("a", { hideAt: 0, hideAnchor: "end" })])).toBeNull();
  });
});
