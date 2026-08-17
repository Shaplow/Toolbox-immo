import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { normalizeTemplateJSON } from "@/lib/templateNormalization";
import type { AnyBlock, TemplateJSON } from "@/types/template";

function tpl(block: Partial<AnyBlock>): TemplateJSON {
  return {
    canvas: { width: 1080, height: 1350, backgroundColor: "#ffffff" },
    blocks: [
      {
        id: "b1",
        type: "text",
        x: 0,
        y: 0,
        w: 100,
        h: 40,
        z: 1,
        animations: [],
        ...block,
      },
    ],
    groups: [],
    schema: [],
    formSections: [],
  } as unknown as TemplateJSON;
}

function block(out: TemplateJSON): AnyBlock {
  return out.blocks[0];
}

describe("normalizeBlock — timing anchors (globaux)", () => {
  it("ancre fin valide conservée avec sa valeur", () => {
    const b = block(normalizeTemplateJSON(tpl({ appearAt: 3, appearAnchor: "end" })));
    expect(b.appearAt).toBe(3);
    expect(b.appearAnchor).toBe("end");
  });

  it("ancre 'start' explicite strippée (JSON propre)", () => {
    const b = block(normalizeTemplateJSON(tpl({ appearAt: 2, appearAnchor: "start" })));
    expect(b.appearAt).toBe(2);
    expect(b.appearAnchor).toBeUndefined();
  });

  it("ancre orpheline (sans valeur) strippée", () => {
    const b = block(normalizeTemplateJSON(tpl({ appearAnchor: "end", hideAnchor: "end" })));
    expect(b.appearAnchor).toBeUndefined();
    expect(b.hideAnchor).toBeUndefined();
  });

  it("ancre fin avec valeur 0 → paire droppée (dégénéré)", () => {
    const b = block(normalizeTemplateJSON(tpl({ hideAt: 0, hideAnchor: "end" })));
    expect(b.hideAt).toBeUndefined();
    expect(b.hideAnchor).toBeUndefined();
  });

  it("comportement legacy inchangé : appearAt <= 0 strippé", () => {
    const b = block(normalizeTemplateJSON(tpl({ appearAt: 0, hideAt: -2 })));
    expect(b.appearAt).toBeUndefined();
    expect(b.hideAt).toBeUndefined();
  });
});

describe("normalizeBlock — sanitize slotTimings", () => {
  it("entrée valide avec ancres conservée, 'start' explicite strippé", () => {
    const b = block(
      normalizeTemplateJSON(
        tpl({
          slotTimings: {
            s1: { appearAt: 3, appearAnchor: "end", hideAt: 1, hideAnchor: "end" },
            s2: { appearAt: 1, appearAnchor: "start", hideAt: 4 },
          },
        }),
      ),
    );
    expect(b.slotTimings?.s1).toEqual({ appearAt: 3, appearAnchor: "end", hideAt: 1, hideAnchor: "end" });
    expect(b.slotTimings?.s2).toEqual({ appearAt: 1, hideAt: 4 });
  });

  it("appearAt: 0 en override slot conservé (significatif face au global)", () => {
    const b = block(
      normalizeTemplateJSON(tpl({ appearAt: 2, slotTimings: { s1: { appearAt: 0 } } })),
    );
    expect(b.slotTimings?.s1).toEqual({ appearAt: 0 });
  });

  it("hideAt: 0 en override slot droppé (cohérent avec le sanitize global)", () => {
    const b = block(normalizeTemplateJSON(tpl({ slotTimings: { s1: { hideAt: 0, appearAt: 1 } } })));
    expect(b.slotTimings?.s1).toEqual({ appearAt: 1 });
  });

  it("entrée vide {} supprimée, record vide → undefined", () => {
    const b = block(normalizeTemplateJSON(tpl({ slotTimings: { s1: {}, s2: { appearAnchor: "end" } } })));
    expect(b.slotTimings).toBeUndefined();
  });

  it("valeurs non numériques droppées", () => {
    const b = block(
      normalizeTemplateJSON(
        tpl({ slotTimings: { s1: { appearAt: "abc" as unknown as number, hideAt: 5 } } }),
      ),
    );
    expect(b.slotTimings?.s1).toEqual({ hideAt: 5 });
  });
});
