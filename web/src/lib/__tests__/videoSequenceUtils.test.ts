import { describe, it, expect } from "vitest";
import {
  buildDefaultSlotFromVideoBlock,
  computeEffectiveDisplayDuration,
  distributeDisplayDuration,
  ensureVideoSequence,
  getVisibleSlotsForBlock,
  isBlockVisibleInSlot,
  resolveBlockTimingInSlot,
  SLOT_AUTO_DURATION,
} from "@/lib/videoSequenceUtils";
import type { TemplateJSON, TextBlock, VideoBlock, VideoSequenceSlot } from "@/types/template";

function mkBlock(overrides: Partial<TextBlock> = {}): TextBlock {
  return {
    id: "block-1",
    type: "text",
    x: 0, y: 0, w: 100, h: 50, z: 0,
    text: "demo",
    ...overrides,
  } as TextBlock;
}

function mkSlot(id: string, opts: Partial<VideoSequenceSlot> = {}): VideoSequenceSlot {
  return { id, ...opts };
}

function makeVideoBlock(overrides: Partial<VideoBlock> = {}): VideoBlock {
  return {
    id: "vb-1",
    type: "video",
    x: 0,
    y: 0,
    w: 1080,
    h: 1920,
    binding: "video",
    ...overrides,
  } as VideoBlock;
}

function makeTemplate(blocks: VideoBlock[]): TemplateJSON {
  return {
    canvas: { format: "REELS", width: 1080, height: 1920, fps: 30, durationSec: 15 } as TemplateJSON["canvas"],
    theme: {} as TemplateJSON["theme"],
    blocks,
    groups: [],
    formSections: [],
    schema: [],
  };
}

// ─── buildDefaultSlotFromVideoBlock ───────────────────────────────────────────

describe("buildDefaultSlotFromVideoBlock", () => {
  it("copie binding/libraryId/selectionRule du VideoBlock", () => {
    const vb = makeVideoBlock({
      id: "vb-x",
      binding: "myField",
      libraryId: "lib-1",
      selectionRule: { strategy: "theme_sequence" } as VideoBlock["selectionRule"],
    });
    const slot = buildDefaultSlotFromVideoBlock(vb, { id: "slot-1", label: "Clip 1" });
    expect(slot.id).toBe("slot-1");
    expect(slot.label).toBe("Clip 1");
    expect(slot.videoBlockId).toBe("vb-x");
    expect(slot.binding).toBe("myField");
    expect(slot.libraryId).toBe("lib-1");
    expect(slot.selectionRule).toEqual({ strategy: "theme_sequence" });
  });

  it("label par défaut = 'Vidéo' si non fourni", () => {
    const slot = buildDefaultSlotFromVideoBlock(makeVideoBlock(), { id: "x" });
    expect(slot.label).toBe("Vidéo");
  });
});

// ─── ensureVideoSequence ──────────────────────────────────────────────────────

describe("ensureVideoSequence", () => {
  it("template sans VideoBlock ni sequence : pas de modification", () => {
    const tpl = makeTemplate([]);
    const out = ensureVideoSequence(tpl, () => "stable-id");
    expect(out).toBe(tpl); // référence identique = pas de copie
    expect(out.videoSequence).toBeUndefined();
  });

  it("template avec videoSequence non-vide : pas de modification", () => {
    const tpl: TemplateJSON = {
      ...makeTemplate([makeVideoBlock()]),
      videoSequence: [{ id: "existing", label: "Existing" }],
    };
    const out = ensureVideoSequence(tpl, () => "stable-id");
    expect(out).toBe(tpl);
    expect(out.videoSequence).toHaveLength(1);
    expect(out.videoSequence?.[0]?.id).toBe("existing");
  });

  it("template avec VideoBlock + pas de sequence : crée un slot par défaut", () => {
    const tpl = makeTemplate([
      makeVideoBlock({ id: "vb-main", binding: "video", libraryId: "lib-main" }),
    ]);
    const out = ensureVideoSequence(tpl, () => "generated-id");
    expect(out).not.toBe(tpl); // copie créée
    expect(out.videoSequence).toHaveLength(1);
    expect(out.videoSequence?.[0]).toMatchObject({
      id: "generated-id",
      label: "Vidéo",
      videoBlockId: "vb-main",
      binding: "video",
      libraryId: "lib-main",
    });
  });

  it("idempotent : 2e appel sur le résultat ne change rien", () => {
    const tpl = makeTemplate([makeVideoBlock()]);
    const out1 = ensureVideoSequence(tpl, () => "id-1");
    const out2 = ensureVideoSequence(out1, () => "id-2");
    expect(out2).toBe(out1);
    expect(out2.videoSequence).toHaveLength(1);
    expect(out2.videoSequence?.[0]?.id).toBe("id-1"); // garde le 1er id
  });

  it("ne mute pas l'input même quand il crée un slot", () => {
    const tpl = makeTemplate([makeVideoBlock()]);
    ensureVideoSequence(tpl, () => "id");
    expect(tpl.videoSequence).toBeUndefined();
  });
});

// ─── isBlockVisibleInSlot ────────────────────────────────────────────────────

describe("isBlockVisibleInSlot", () => {
  it("overlayGroupIds undefined → visible", () => {
    expect(isBlockVisibleInSlot(mkBlock(), mkSlot("s1"))).toBe(true);
  });

  it("overlayGroupIds = [] → invisible", () => {
    expect(isBlockVisibleInSlot(mkBlock(), mkSlot("s1", { overlayGroupIds: [] }))).toBe(false);
  });

  it("overlayGroupIds = [g1] et block sans groupId → invisible", () => {
    expect(
      isBlockVisibleInSlot(mkBlock(), mkSlot("s1", { overlayGroupIds: ["g1"] })),
    ).toBe(false);
  });

  it("overlayGroupIds = [g1] et block.groupId = g1 → visible", () => {
    expect(
      isBlockVisibleInSlot(
        mkBlock({ groupId: "g1" }),
        mkSlot("s1", { overlayGroupIds: ["g1"] }),
      ),
    ).toBe(true);
  });
});

// ─── resolveBlockTimingInSlot ────────────────────────────────────────────────

describe("resolveBlockTimingInSlot", () => {
  it("aucun override → 0 / slotDuration", () => {
    expect(resolveBlockTimingInSlot(mkBlock(), "s1", 2)).toEqual({ appearAt: 0, hideAt: 2 });
  });

  it("appearAt/hideAt globaux → utilisés", () => {
    expect(
      resolveBlockTimingInSlot(mkBlock({ appearAt: 0.5, hideAt: 1.5 }), "s1", 2),
    ).toEqual({ appearAt: 0.5, hideAt: 1.5 });
  });

  it("slotTimings prioritaire sur global", () => {
    const block = mkBlock({
      appearAt: 0.5,
      hideAt: 1.5,
      slotTimings: { s1: { appearAt: 0.2, hideAt: 1.0 } },
    });
    expect(resolveBlockTimingInSlot(block, "s1", 2)).toEqual({ appearAt: 0.2, hideAt: 1.0 });
  });
});

// ─── getVisibleSlotsForBlock ─────────────────────────────────────────────────

describe("getVisibleSlotsForBlock", () => {
  it("videoSequence undefined → []", () => {
    expect(getVisibleSlotsForBlock(mkBlock(), undefined)).toEqual([]);
  });

  it("respecte l'ordre + filtre selon overlayGroupIds", () => {
    const block = mkBlock({ groupId: "g1" });
    const intro = mkSlot("intro", { overlayGroupIds: ["g1"] });
    const content = mkSlot("content"); // mode data
    const outro = mkSlot("outro", { overlayGroupIds: [] }); // raw
    const result = getVisibleSlotsForBlock(block, [intro, content, outro]);
    expect(result.map((s) => s.id)).toEqual(["intro", "content"]);
  });
});

// ─── distributeDisplayDuration ───────────────────────────────────────────────

describe("distributeDisplayDuration", () => {
  it("0 slots visibles + durée demandée → capped=true", () => {
    expect(distributeDisplayDuration(mkBlock(), 1.5, [])).toEqual({
      slotTimings: {},
      consumed: 0,
      capped: true,
    });
  });

  it("0 slots + durée 0 → capped=false", () => {
    expect(distributeDisplayDuration(mkBlock(), 0, [])).toEqual({
      slotTimings: {},
      consumed: 0,
      capped: false,
    });
  });

  it("durée plus courte que le premier slot → slotTimings[s1] = { 0, 1.5 }", () => {
    const intro = mkSlot("intro", { maxDuration: 2 });
    const result = distributeDisplayDuration(mkBlock(), 1.5, [intro]);
    expect(result.slotTimings).toEqual({ intro: { appearAt: 0, hideAt: 1.5 } });
    expect(result.consumed).toBe(1.5);
    expect(result.capped).toBe(false);
  });

  it("durée traverse INTRO et s'arrête dans CONTENT", () => {
    const intro = mkSlot("intro", { maxDuration: 2 });
    const content = mkSlot("content", { maxDuration: 3 });
    const result = distributeDisplayDuration(mkBlock(), 2.5, [intro, content]);
    expect(result.slotTimings).toEqual({
      content: { appearAt: 0, hideAt: 0.5 },
    });
    expect(result.consumed).toBe(2.5);
    expect(result.capped).toBe(false);
  });

  it("durée excessive → consume tout + capped=true sans overrides", () => {
    const intro = mkSlot("intro", { maxDuration: 2 });
    const content = mkSlot("content", { maxDuration: 3 });
    const result = distributeDisplayDuration(mkBlock(), 10, [intro, content]);
    expect(result.slotTimings).toEqual({});
    expect(result.consumed).toBe(5);
    expect(result.capped).toBe(true);
  });

  it("appearAt=0.5 sur INTRO(2s), durée 1s → s'éteint à t=1.5", () => {
    const intro = mkSlot("intro", { maxDuration: 2 });
    const result = distributeDisplayDuration(mkBlock({ appearAt: 0.5 }), 1, [intro]);
    expect(result.slotTimings).toEqual({ intro: { appearAt: 0.5, hideAt: 1.5 } });
    expect(result.consumed).toBe(1);
    expect(result.capped).toBe(false);
  });

  it("appearAt=0.5 INTRO(2s)+CONTENT(3s), durée 2 → traverse, finit dans CONTENT à t=0.5", () => {
    const intro = mkSlot("intro", { maxDuration: 2 });
    const content = mkSlot("content", { maxDuration: 3 });
    const result = distributeDisplayDuration(mkBlock({ appearAt: 0.5 }), 2, [intro, content]);
    expect(result.slotTimings).toEqual({
      intro: { appearAt: 0.5, hideAt: 2 },
      content: { appearAt: 0, hideAt: 0.5 },
    });
    expect(result.consumed).toBe(2);
    expect(result.capped).toBe(false);
  });

  it("3 slots, durée s'éteint dans content → outro invisible (hideAt:0)", () => {
    const intro = mkSlot("intro", { maxDuration: 2 });
    const content = mkSlot("content", { maxDuration: 3 });
    const outro = mkSlot("outro", { maxDuration: 2 });
    const result = distributeDisplayDuration(mkBlock(), 2.5, [intro, content, outro]);
    expect(result.slotTimings).toEqual({
      content: { appearAt: 0, hideAt: 0.5 },
      outro: { hideAt: 0 },
    });
    expect(result.consumed).toBe(2.5);
    expect(result.capped).toBe(false);
  });

  it("slot sans maxDuration → utilise SLOT_AUTO_DURATION", () => {
    const auto = mkSlot("auto");
    const result = distributeDisplayDuration(mkBlock(), 3, [auto]);
    expect(result.slotTimings).toEqual({ auto: { appearAt: 0, hideAt: 3 } });
    expect(SLOT_AUTO_DURATION).toBe(10);
  });
});

// ─── computeEffectiveDisplayDuration ────────────────────────────────────────

describe("computeEffectiveDisplayDuration", () => {
  it("aucun override → undefined", () => {
    const intro = mkSlot("intro", { maxDuration: 2 });
    expect(computeEffectiveDisplayDuration(mkBlock(), [intro])).toBeUndefined();
  });

  it("0 slots visibles → undefined", () => {
    expect(computeEffectiveDisplayDuration(mkBlock(), [])).toBeUndefined();
  });

  it("slotTimings[intro].hideAt = 1.5 → 1.5", () => {
    const block = mkBlock({ slotTimings: { intro: { hideAt: 1.5 } } });
    const intro = mkSlot("intro", { maxDuration: 2 });
    expect(computeEffectiveDisplayDuration(block, [intro])).toBe(1.5);
  });

  it("INTRO consommé + CONTENT cut at 0.5 → 2.5", () => {
    const block = mkBlock({ slotTimings: { content: { hideAt: 0.5 } } });
    const intro = mkSlot("intro", { maxDuration: 2 });
    const content = mkSlot("content", { maxDuration: 3 });
    expect(computeEffectiveDisplayDuration(block, [intro, content])).toBe(2.5);
  });

  it("round-trip distribute → compute identique (2.5s)", () => {
    const intro = mkSlot("intro", { maxDuration: 2 });
    const content = mkSlot("content", { maxDuration: 3 });
    const { slotTimings } = distributeDisplayDuration(mkBlock(), 2.5, [intro, content]);
    const block = mkBlock({ slotTimings });
    expect(computeEffectiveDisplayDuration(block, [intro, content])).toBe(2.5);
  });

  it("round-trip avec appearAt → 2s", () => {
    const intro = mkSlot("intro", { maxDuration: 2 });
    const content = mkSlot("content", { maxDuration: 3 });
    const { slotTimings } = distributeDisplayDuration(mkBlock({ appearAt: 0.5 }), 2, [intro, content]);
    const block = mkBlock({ appearAt: 0.5, slotTimings });
    expect(computeEffectiveDisplayDuration(block, [intro, content])).toBe(2);
  });
});
