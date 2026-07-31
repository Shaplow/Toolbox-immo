/**
 * Héritage des conditions d'un groupe PARENT par les blocs de ses sous-groupes.
 *
 * `block.groupId` est plat : il pointe toujours vers le groupe feuille. Sans
 * remontée de chaîne, masquer un groupe parent (œil du panneau des calques) ou
 * lui poser une règle conditionnelle n'avait aucun effet sur les blocs de ses
 * sous-groupes — ils restaient visibles dans le builder ET dans la vidéo livrée
 * au client, et un offset conditionnel disloquait le groupe à mi-hauteur.
 */

import { describe, it, expect } from "vitest";
import {
  getGroupChain,
  isBlockVisibleForListing,
  resolveBlockForListing,
  resolveBlockState,
} from "@/lib/templateConditions";
import type { AnyBlock, LayerGroup, TextBlock } from "@/types/template";

function block(id: string, groupId?: string, overrides: Partial<TextBlock> = {}): TextBlock {
  return {
    id,
    type: "text",
    x: 10,
    y: 20,
    w: 100,
    h: 40,
    z: 0,
    animations: [],
    style: {},
    rules: {},
    content: id,
    groupId,
    ...overrides,
  } as TextBlock;
}

const PARENT: LayerGroup = { id: "parent", name: "Parent", layout: { mode: "column" } };
const SUB: LayerGroup = { id: "sub", name: "Sous-groupe", parentGroupId: "parent", layout: { mode: "row" } };
const GROUPS = [PARENT, SUB];

describe("getGroupChain", () => {
  it("remonte du sous-groupe vers son parent, ancêtre en tête", () => {
    expect(getGroupChain(SUB, GROUPS).map((g) => g.id)).toEqual(["parent", "sub"]);
  });

  it("un groupe top-level est seul dans sa chaîne", () => {
    expect(getGroupChain(PARENT, GROUPS).map((g) => g.id)).toEqual(["parent"]);
  });

  it("parent introuvable → le groupe est traité comme top-level", () => {
    const orphan: LayerGroup = { id: "orphan", name: "o", parentGroupId: "disparu" };
    expect(getGroupChain(orphan, GROUPS).map((g) => g.id)).toEqual(["orphan"]);
  });

  it("sans liste de groupes → pas de remontée (compat appelants historiques)", () => {
    expect(getGroupChain(SUB, undefined).map((g) => g.id)).toEqual(["sub"]);
  });

  it("cycle → s'arrête sans boucler", () => {
    const a: LayerGroup = { id: "a", name: "a", parentGroupId: "b" };
    const b: LayerGroup = { id: "b", name: "b", parentGroupId: "a" };
    expect(getGroupChain(a, [a, b]).map((g) => g.id).length).toBeLessThanOrEqual(2);
  });
});

describe("hidden d'un groupe parent", () => {
  it("masque les blocs de ses sous-groupes", () => {
    const hiddenParent = { ...PARENT, hidden: true };
    expect(
      isBlockVisibleForListing(block("b1", "sub"), {}, SUB, [hiddenParent, SUB]),
    ).toBe(false);
  });

  it("laisse visibles les blocs quand le parent ne l'est pas", () => {
    expect(isBlockVisibleForListing(block("b1", "sub"), {}, SUB, GROUPS)).toBe(true);
  });

  it("le sous-groupe masqué masque ses propres blocs, sans toucher au parent", () => {
    const hiddenSub = { ...SUB, hidden: true };
    expect(isBlockVisibleForListing(block("b1", "sub"), {}, hiddenSub, [PARENT, hiddenSub])).toBe(false);
    expect(isBlockVisibleForListing(block("b2", "parent"), {}, PARENT, [PARENT, hiddenSub])).toBe(true);
  });
});

describe("conditionalRules d'un groupe parent", () => {
  const parentHideRule: LayerGroup = {
    ...PARENT,
    conditionalRules: [{ when: { field: "type", equals: "location" }, effects: { visible: false } }],
  };

  it("une règle de masquage du parent s'applique aux blocs du sous-groupe", () => {
    expect(
      isBlockVisibleForListing(block("b1", "sub"), { type: "location" }, SUB, [parentHideRule, SUB]),
    ).toBe(false);
  });

  it("la même règle ne masque rien quand la condition ne matche pas", () => {
    expect(
      isBlockVisibleForListing(block("b1", "sub"), { type: "vente" }, SUB, [parentHideRule, SUB]),
    ).toBe(true);
  });

  it("les règles du parent sont remontées dans le résultat", () => {
    const state = resolveBlockState(block("b1", "sub"), { type: "vente" }, SUB, [parentHideRule, SUB]);
    expect(state.rules).toHaveLength(1);
  });
});

describe("effets de position d'un groupe parent", () => {
  const parentOffset: LayerGroup = {
    ...PARENT,
    conditionalRules: [{ when: { field: "dpe", equals: "absent" }, effects: { offsetY: 40 } }],
  };

  it("décale aussi les blocs des sous-groupes (le groupe ne se disloque pas)", () => {
    const direct = resolveBlockForListing(
      block("direct", "parent") as AnyBlock,
      { dpe: "absent" },
      parentOffset,
      [parentOffset, SUB],
    );
    const nested = resolveBlockForListing(
      block("nested", "sub") as AnyBlock,
      { dpe: "absent" },
      SUB,
      [parentOffset, SUB],
    );
    expect(direct.y).toBe(60);
    expect(nested.y).toBe(60);
  });

  it("sans condition satisfaite, les positions sont intactes", () => {
    const nested = resolveBlockForListing(
      block("nested", "sub") as AnyBlock,
      { dpe: "present" },
      SUB,
      [parentOffset, SUB],
    );
    expect(nested.y).toBe(20);
  });
});
