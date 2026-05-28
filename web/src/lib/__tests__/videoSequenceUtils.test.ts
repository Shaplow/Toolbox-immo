import { describe, it, expect } from "vitest";
import {
  buildDefaultSlotFromVideoBlock,
  ensureVideoSequence,
} from "@/lib/videoSequenceUtils";
import type { TemplateJSON, VideoBlock } from "@/types/template";

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
