import { describe, it, expect } from "vitest";
import {
  buildDefaultSlotFromVideoBlock,
  ensureVideoSequence,
  isBlockVisibleInSlot,
  resolveBlockTimingInSlot,
  resolveBlockTimingRefs,
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
  // g1 = groupe parent, sub1 = sous-groupe de g1, g2 = groupe indépendant.
  const GROUPS = [
    { id: "g1" },
    { id: "sub1", parentGroupId: "g1" },
    { id: "g2" },
  ];

  it("overlayGroupIds undefined → visible", () => {
    expect(isBlockVisibleInSlot(mkBlock(), mkSlot("s1"), GROUPS)).toBe(true);
  });

  it("overlayGroupIds = [] → invisible", () => {
    expect(isBlockVisibleInSlot(mkBlock(), mkSlot("s1", { overlayGroupIds: [] }), GROUPS)).toBe(false);
  });

  it("overlayGroupIds = [g1] et block sans groupId → invisible", () => {
    expect(
      isBlockVisibleInSlot(mkBlock(), mkSlot("s1", { overlayGroupIds: ["g1"] }), GROUPS),
    ).toBe(false);
  });

  it("overlayGroupIds = [g1] et block.groupId = g1 → visible", () => {
    expect(
      isBlockVisibleInSlot(
        mkBlock({ groupId: "g1" }),
        mkSlot("s1", { overlayGroupIds: ["g1"] }),
        GROUPS,
      ),
    ).toBe(true);
  });

  it("bloc d'un SOUS-GROUPE et slot cochant le parent → visible", () => {
    expect(
      isBlockVisibleInSlot(
        mkBlock({ groupId: "sub1" }),
        mkSlot("s1", { overlayGroupIds: ["g1"] }),
        GROUPS,
      ),
    ).toBe(true);
  });

  it("bloc d'un sous-groupe et slot cochant le sous-groupe seul → visible", () => {
    expect(
      isBlockVisibleInSlot(
        mkBlock({ groupId: "sub1" }),
        mkSlot("s1", { overlayGroupIds: ["sub1"] }),
        GROUPS,
      ),
    ).toBe(true);
  });

  it("bloc direct du parent et slot cochant le sous-groupe seul → invisible (relation à sens unique)", () => {
    expect(
      isBlockVisibleInSlot(
        mkBlock({ groupId: "g1" }),
        mkSlot("s1", { overlayGroupIds: ["sub1"] }),
        GROUPS,
      ),
    ).toBe(false);
  });

  it("aucune hiérarchie fournie → comportement plat historique", () => {
    expect(
      isBlockVisibleInSlot(
        mkBlock({ groupId: "sub1" }),
        mkSlot("s1", { overlayGroupIds: ["g1"] }),
        [],
      ),
    ).toBe(false);
  });
});

// ─── resolveBlockTimingInSlot ────────────────────────────────────────────────

describe("resolveBlockTimingInSlot", () => {
  it("aucun override → 0 / slotDuration", () => {
    expect(resolveBlockTimingInSlot(mkBlock(), "s1", 2)).toEqual({
      appearAt: 0,
      hideAt: 2,
      appearAnchor: "start",
      hideAnchor: "start",
    });
  });

  it("appearAt/hideAt globaux → utilisés", () => {
    expect(
      resolveBlockTimingInSlot(mkBlock({ appearAt: 0.5, hideAt: 1.5 }), "s1", 2),
    ).toMatchObject({ appearAt: 0.5, hideAt: 1.5 });
  });

  it("slotTimings prioritaire sur global", () => {
    const block = mkBlock({
      appearAt: 0.5,
      hideAt: 1.5,
      slotTimings: { s1: { appearAt: 0.2, hideAt: 1.0 } },
    });
    expect(resolveBlockTimingInSlot(block, "s1", 2)).toMatchObject({ appearAt: 0.2, hideAt: 1.0 });
  });

  it("ancre fin → position résolue à l'échelle du slot", () => {
    const block = mkBlock({ slotTimings: { s1: { appearAt: 3, appearAnchor: "end" } } });
    expect(resolveBlockTimingInSlot(block, "s1", 10)).toEqual({
      appearAt: 7,
      hideAt: 10,
      appearAnchor: "end",
      hideAnchor: "start",
    });
  });

  it("ancre fin plus grande que le slot → clamp à 0", () => {
    const block = mkBlock({ slotTimings: { s1: { appearAt: 15, appearAnchor: "end" } } });
    expect(resolveBlockTimingInSlot(block, "s1", 10)).toMatchObject({ appearAt: 0 });
  });

  it("hideAt résolu jamais avant appearAt (clamp)", () => {
    const block = mkBlock({
      slotTimings: { s1: { appearAt: 6, hideAt: 8, hideAnchor: "end" } },
    });
    // hideAt = 10 − 8 = 2 < appearAt 6 → clampé à 6
    expect(resolveBlockTimingInSlot(block, "s1", 10)).toMatchObject({ appearAt: 6, hideAt: 6 });
  });
});

// ─── resolveBlockTimingRefs ──────────────────────────────────────────────────

describe("resolveBlockTimingRefs", () => {
  it("résolution par paire : ancre slot sans valeur slot → global utilisé avec SON ancre", () => {
    const block = mkBlock({
      appearAt: 2,
      appearAnchor: "end",
      slotTimings: { s1: { hideAt: 4 } },
    });
    expect(resolveBlockTimingRefs(block, "s1")).toEqual({
      appear: { anchor: "end", value: 2 },
      hide: { anchor: "start", value: 4 },
    });
  });

  it("l'ancre globale ne contamine pas la valeur du slot", () => {
    const block = mkBlock({
      appearAt: 2,
      appearAnchor: "end",
      slotTimings: { s1: { appearAt: 1 } },
    });
    expect(resolveBlockTimingRefs(block, "s1").appear).toEqual({ anchor: "start", value: 1 });
  });

  it("sans slotId → globaux seulement", () => {
    const block = mkBlock({ hideAt: 3, hideAnchor: "end", slotTimings: { s1: { appearAt: 1 } } });
    expect(resolveBlockTimingRefs(block)).toEqual({
      appear: null,
      hide: { anchor: "end", value: 3 },
    });
  });
});

