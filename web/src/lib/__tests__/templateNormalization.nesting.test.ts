import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { normalizeTemplateJSON, CURRENT_TEMPLATE_SCHEMA_VERSION } from "@/lib/templateNormalization";
import type { LayerGroup, TemplateJSON } from "@/types/template";

function tpl(groups: LayerGroup[]): TemplateJSON {
  return {
    canvas: { width: 1080, height: 1350, backgroundColor: "#ffffff" },
    blocks: [],
    groups,
    schema: [],
    formSections: [],
  } as unknown as TemplateJSON;
}

const grp = (id: string, parentGroupId?: string): LayerGroup => ({
  id,
  name: id,
  layout: { mode: "column" },
  parentGroupId,
});

function byId(t: TemplateJSON, id: string) {
  return t.groups.find((g) => g.id === id);
}

describe("normalizeTemplateJSON — garde-fous imbrication", () => {
  it("sous-groupe valide (parent top-level) → parentGroupId conservé", () => {
    const out = normalizeTemplateJSON(tpl([grp("parent"), grp("sub", "parent")]));
    expect(byId(out, "sub")?.parentGroupId).toBe("parent");
  });

  it("parent inexistant → parentGroupId nettoyé", () => {
    const out = normalizeTemplateJSON(tpl([grp("sub", "ghost")]));
    expect(byId(out, "sub")?.parentGroupId).toBeUndefined();
  });

  it("cycle direct (groupe parent de lui-même) → nettoyé", () => {
    const out = normalizeTemplateJSON(tpl([grp("a", "a")]));
    expect(byId(out, "a")?.parentGroupId).toBeUndefined();
  });

  it("profondeur > 1 (petit-enfant) → promu top-level", () => {
    // a (top) ← b (enfant de a) ← c (enfant de b, niveau 2)
    const out = normalizeTemplateJSON(tpl([grp("a"), grp("b", "a"), grp("c", "b")]));
    expect(byId(out, "b")?.parentGroupId).toBe("a"); // niveau 1 OK
    expect(byId(out, "c")?.parentGroupId).toBeUndefined(); // niveau 2 → promu
  });

  it("template plat → inchangé + schemaVersion stampé à 2", () => {
    const out = normalizeTemplateJSON(tpl([grp("solo")]));
    expect(byId(out, "solo")?.parentGroupId).toBeUndefined();
    expect(out.schemaVersion).toBe(CURRENT_TEMPLATE_SCHEMA_VERSION);
    expect(CURRENT_TEMPLATE_SCHEMA_VERSION).toBe(2);
  });
});
