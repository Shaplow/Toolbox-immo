/**
 * Dissolution d'un groupe dans le builder.
 *
 * Le cas qui posait problème : dissoudre un SOUS-groupe (bouton « × » de la
 * ligne dans le panneau des calques) détachait ses blocs au lieu de les
 * remonter dans le parent. Ils sortaient de la colonne, perdaient les règles
 * conditionnelles du parent, et disparaissaient de tous les clips et covers
 * dont la sélection cochait le parent — le filtre porte sur `block.groupId`,
 * et `undefined` n'appartient à aucun groupe.
 *
 * Premier test du store : `builderStore.ts` n'en avait aucun.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useBuilderStore } from "@/lib/store/builderStore";
import { emptyTemplate } from "@/types/template";
import type { AnyBlock, LayerGroup, TemplateJSON, TextBlock } from "@/types/template";

function textBlock(id: string, groupId?: string): TextBlock {
  return {
    id,
    type: "text",
    x: 0,
    y: 0,
    w: 100,
    h: 40,
    z: 0,
    animations: [],
    style: {},
    rules: {},
    content: id,
    groupId,
  } as TextBlock;
}

const PARENT: LayerGroup = { id: "parent", name: "Parent", layout: { mode: "column", gap: 8 } };
const SUB: LayerGroup = { id: "sub", name: "Sous-groupe", parentGroupId: "parent", layout: { mode: "row", gap: 8 } };

function makeTemplate(groups: LayerGroup[], blocks: AnyBlock[]): TemplateJSON {
  return { ...emptyTemplate(), groups, blocks };
}

function groupIdOf(id: string): string | undefined {
  return useBuilderStore.getState().template.blocks.find((b) => b.id === id)?.groupId;
}

beforeEach(() => {
  useBuilderStore.setState({ selectedGroupId: null, selectedBlockId: null });
});

describe("removeGroup — sous-groupe", () => {
  it("remonte les blocs du sous-groupe dans le parent", () => {
    useBuilderStore.getState().setTemplate(
      makeTemplate([PARENT, SUB], [textBlock("direct", "parent"), textBlock("nested", "sub")]),
    );

    useBuilderStore.getState().removeGroup("sub");

    expect(groupIdOf("nested")).toBe("parent");
    expect(groupIdOf("direct")).toBe("parent");
    expect(useBuilderStore.getState().template.groups.map((g) => g.id)).toEqual(["parent"]);
  });

  it("désélectionne le sous-groupe dissous", () => {
    useBuilderStore.getState().setTemplate(
      makeTemplate([PARENT, SUB], [textBlock("nested", "sub")]),
    );
    useBuilderStore.setState({ selectedGroupId: "sub" });

    useBuilderStore.getState().removeGroup("sub");

    expect(useBuilderStore.getState().selectedGroupId).toBeNull();
  });
});

describe("removeGroup — groupe top-level", () => {
  it("détache les blocs (aucun parent où les remonter)", () => {
    useBuilderStore.getState().setTemplate(
      makeTemplate([PARENT], [textBlock("direct", "parent")]),
    );

    useBuilderStore.getState().removeGroup("parent");

    expect(groupIdOf("direct")).toBeUndefined();
    expect(useBuilderStore.getState().template.groups).toEqual([]);
  });

  it("dissout aussi ses sous-groupes et détache tous leurs blocs", () => {
    useBuilderStore.getState().setTemplate(
      makeTemplate([PARENT, SUB], [textBlock("direct", "parent"), textBlock("nested", "sub")]),
    );

    useBuilderStore.getState().removeGroup("parent");

    expect(useBuilderStore.getState().template.groups).toEqual([]);
    expect(groupIdOf("direct")).toBeUndefined();
    expect(groupIdOf("nested")).toBeUndefined();
  });
});
