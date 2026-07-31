import { describe, it, expect } from "vitest";
import {
  GAP_MIN,
  buildGroupTree,
  computeAutoLayoutPositions,
  computeAutoLayoutPositionsForTree,
  expandGroupIdsWithChildren,
  getChildAutoLayoutGroups,
  getEffectiveBoxOffset,
  getBlockAnchorOffset,
  getGroupBounds,
  normalizeGroupLayout,
  getAutoLayoutOrderedBlocks,
  type BlockLayoutSize,
} from "@/lib/groupLayout";
import type {
  AnyBlock,
  TextBlock,
  ShapeBlock,
  LayerGroup,
  GroupLayoutConfig,
  BlockStyle,
} from "@/types/template";

// ──────────────────────────────────────────────────────────────────────────
// Fixtures
// Ce fichier fige le comportement ACTUEL du moteur de layout auto-groupes.
// Il sert de filet de parité : toute refonte (sizeToContent Phase 1, groupes
// imbriqués Phase 4) doit garder ces sorties identiques pour les groupes plats.
// ──────────────────────────────────────────────────────────────────────────

type Rect = { x: number; y: number; w: number; h: number; z?: number };

function text(id: string, rect: Rect, style: Partial<BlockStyle> = {}): TextBlock {
  return {
    id,
    type: "text",
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    z: rect.z ?? 0,
    animations: [],
    style,
    rules: {},
    content: id,
  };
}

function shape(id: string, rect: Rect): ShapeBlock {
  return {
    id,
    type: "shape",
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    z: rect.z ?? 0,
    animations: [],
    shape: "rectangle",
    fillColor: "#000000",
  };
}

function group(layout: GroupLayoutConfig | undefined, extra: Partial<LayerGroup> = {}): LayerGroup {
  return { id: "g", name: "g", layout, ...extra };
}

function sizes(entries: Record<string, BlockLayoutSize>): Map<string, BlockLayoutSize> {
  return new Map(Object.entries(entries));
}

function pos(map: Map<string, { x: number; y: number }>, id: string) {
  return map.get(id);
}

// ──────────────────────────────────────────────────────────────────────────
// getGroupBounds
// ──────────────────────────────────────────────────────────────────────────

describe("getGroupBounds", () => {
  it("calcule l'enveloppe des blocs", () => {
    const blocks: AnyBlock[] = [
      text("a", { x: 0, y: 0, w: 100, h: 20 }),
      text("b", { x: 10, y: 30, w: 80, h: 40 }),
      text("c", { x: 0, y: 80, w: 120, h: 20 }),
    ];
    expect(getGroupBounds(blocks)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 120,
      maxY: 100,
      width: 120,
      height: 100,
    });
  });

  it("liste vide → null", () => {
    expect(getGroupBounds([])).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// normalizeGroupLayout
// ──────────────────────────────────────────────────────────────────────────

describe("normalizeGroupLayout", () => {
  it("mode column → defaults (gap 16, justify center, align top)", () => {
    expect(normalizeGroupLayout({ mode: "column" })).toEqual({
      mode: "column",
      gap: 16,
      justify: "center",
      align: "top",
    });
  });

  it("préserve les valeurs fournies et déduplique order", () => {
    expect(
      normalizeGroupLayout({
        mode: "row",
        width: 200,
        height: 120,
        gap: 5,
        justify: "end",
        align: "bottom",
        order: ["a", "b", "a"],
        anchorBlockId: "x",
      }),
    ).toEqual({
      mode: "row",
      width: 200,
      height: 120,
      gap: 5,
      justify: "end",
      align: "bottom",
      order: ["a", "b"],
      anchorBlockId: "x",
    });
  });

  it("mode free → undefined (pas d'auto-layout)", () => {
    expect(normalizeGroupLayout({ mode: "free" })).toBeUndefined();
  });

  // Un écart négatif fait volontairement se chevaucher les blocs. Un écart de 0
  // doit rester 0 : le miroir JS du rendu final le confondait avec « non défini »
  // et le remplaçait par 16 (`gap || 16`), d'où une preview et une vidéo qui
  // divergeaient sur un groupe collé.
  it("préserve un gap négatif", () => {
    expect(normalizeGroupLayout({ mode: "column", gap: -8 })?.gap).toBe(-8);
  });

  it("préserve un gap de 0 (et ne retombe pas sur le défaut)", () => {
    expect(normalizeGroupLayout({ mode: "column", gap: 0 })?.gap).toBe(0);
  });

  it("clampe un gap absurde à GAP_MIN", () => {
    expect(normalizeGroupLayout({ mode: "column", gap: -9999 })?.gap).toBe(GAP_MIN);
  });

  it("arrondit un gap négatif fractionnaire", () => {
    expect(normalizeGroupLayout({ mode: "row", gap: -7.6 })?.gap).toBe(-8);
  });

  it("undefined → undefined", () => {
    expect(normalizeGroupLayout(undefined)).toBeUndefined();
  });

  it("anchorBlockId vide → undefined", () => {
    expect(normalizeGroupLayout({ mode: "column", anchorBlockId: "" })?.anchorBlockId).toBeUndefined();
  });

  it("sizeToContent préservé seulement si true (sinon undefined)", () => {
    expect(normalizeGroupLayout({ mode: "column", sizeToContent: true })?.sizeToContent).toBe(true);
    expect(normalizeGroupLayout({ mode: "column", sizeToContent: false })?.sizeToContent).toBeUndefined();
    expect(normalizeGroupLayout({ mode: "column" })?.sizeToContent).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// getAutoLayoutOrderedBlocks
// ──────────────────────────────────────────────────────────────────────────

describe("getAutoLayoutOrderedBlocks", () => {
  it("colonne sans order → tri par y", () => {
    const blocks: AnyBlock[] = [
      text("c", { x: 0, y: 80, w: 10, h: 10 }),
      text("a", { x: 0, y: 0, w: 10, h: 10 }),
      text("b", { x: 0, y: 30, w: 10, h: 10 }),
    ];
    const ordered = getAutoLayoutOrderedBlocks(group({ mode: "column" }), blocks);
    expect(ordered.map((b) => b.id)).toEqual(["a", "b", "c"]);
  });

  it("order explicite respecté", () => {
    const blocks: AnyBlock[] = [
      text("a", { x: 0, y: 0, w: 10, h: 10 }),
      text("b", { x: 0, y: 30, w: 10, h: 10 }),
      text("c", { x: 0, y: 80, w: 10, h: 10 }),
    ];
    const ordered = getAutoLayoutOrderedBlocks(group({ mode: "column", order: ["c", "a", "b"] }), blocks);
    expect(ordered.map((b) => b.id)).toEqual(["c", "a", "b"]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// getEffectiveBoxOffset
// ──────────────────────────────────────────────────────────────────────────

describe("getEffectiveBoxOffset", () => {
  it("bloc non-texte → {0,0}", () => {
    expect(getEffectiveBoxOffset(shape("s", { x: 0, y: 0, w: 50, h: 50 }), { width: 30, height: 30 })).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("texte sans fond → {0,0}", () => {
    expect(getEffectiveBoxOffset(text("t", { x: 0, y: 0, w: 100, h: 50 }), { width: 60, height: 20 })).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("texte avec fond centré → offset (frame - content)/2", () => {
    const t = text("t", { x: 0, y: 0, w: 100, h: 50 }, {
      textBackgroundEnabled: true,
      textAlign: "center",
      verticalAlign: "middle",
    });
    expect(getEffectiveBoxOffset(t, { width: 60, height: 20 })).toEqual({ x: 20, y: 15 });
  });

  it("texte avec fond aligné droite/bas", () => {
    const t = text("t", { x: 0, y: 0, w: 100, h: 50 }, {
      textBackgroundEnabled: true,
      textAlign: "right",
      verticalAlign: "bottom",
    });
    expect(getEffectiveBoxOffset(t, { width: 60, height: 20 })).toEqual({ x: 40, y: 30 });
  });
});

// ──────────────────────────────────────────────────────────────────────────
// getBlockAnchorOffset
// ──────────────────────────────────────────────────────────────────────────

describe("getBlockAnchorOffset", () => {
  it("bloc non-texte → centre", () => {
    expect(getBlockAnchorOffset(shape("s", { x: 0, y: 0, w: 100, h: 40 }), { width: 100, height: 40 })).toEqual({
      x: 50,
      y: 20,
    });
  });

  it("texte sans align explicite → centre", () => {
    expect(getBlockAnchorOffset(text("t", { x: 0, y: 0, w: 100, h: 40 }), { width: 100, height: 40 })).toEqual({
      x: 50,
      y: 20,
    });
  });

  it("texte top-left sans fond → coin (padding 0)", () => {
    const t = text("t", { x: 0, y: 0, w: 100, h: 40 }, { textAlign: "left", verticalAlign: "top" });
    expect(getBlockAnchorOffset(t, { width: 100, height: 40 })).toEqual({ x: 0, y: 0 });
  });
});

// ──────────────────────────────────────────────────────────────────────────
// computeAutoLayoutPositions — colonne
// ──────────────────────────────────────────────────────────────────────────

describe("computeAutoLayoutPositions — colonne", () => {
  const columnBlocks = (): AnyBlock[] => [
    text("a", { x: 0, y: 0, w: 100, h: 20, z: 0 }),
    text("b", { x: 0, y: 30, w: 100, h: 40, z: 1 }),
    text("c", { x: 0, y: 80, w: 100, h: 20, z: 2 }),
  ];

  it("justify start → empile depuis le haut (haut figé)", () => {
    const map = computeAutoLayoutPositions(
      group({ mode: "column", gap: 10, justify: "start", align: "top" }),
      columnBlocks(),
    );
    expect(pos(map, "a")).toEqual({ x: 0, y: 0 });
    expect(pos(map, "b")).toEqual({ x: 0, y: 30 });
    expect(pos(map, "c")).toEqual({ x: 0, y: 80 });
  });

  it("justify center dans un cadre plus grand → bloc centré verticalement", () => {
    const map = computeAutoLayoutPositions(
      group({ mode: "column", gap: 10, justify: "center", align: "top", height: 200 }),
      columnBlocks(),
    );
    expect(pos(map, "a")).toEqual({ x: 0, y: 50 });
    expect(pos(map, "b")).toEqual({ x: 0, y: 80 });
    expect(pos(map, "c")).toEqual({ x: 0, y: 130 });
  });

  it("justify end dans un cadre plus grand → collé en bas", () => {
    const map = computeAutoLayoutPositions(
      group({ mode: "column", gap: 10, justify: "end", align: "top", height: 200 }),
      columnBlocks(),
    );
    expect(pos(map, "a")).toEqual({ x: 0, y: 100 });
    expect(pos(map, "b")).toEqual({ x: 0, y: 130 });
    expect(pos(map, "c")).toEqual({ x: 0, y: 180 });
  });

  it("align middle → centrage horizontal selon largeur de chaque bloc", () => {
    const blocks: AnyBlock[] = [
      text("a", { x: 0, y: 0, w: 100, h: 20, z: 0 }),
      text("b", { x: 0, y: 30, w: 50, h: 20, z: 1 }),
      text("c", { x: 0, y: 60, w: 80, h: 20, z: 2 }),
    ];
    const map = computeAutoLayoutPositions(
      group({ mode: "column", gap: 10, justify: "start", align: "middle", width: 200 }),
      blocks,
    );
    expect(pos(map, "a")).toEqual({ x: 50, y: 0 });
    expect(pos(map, "b")).toEqual({ x: 75, y: 30 });
    expect(pos(map, "c")).toEqual({ x: 60, y: 60 });
  });

  it("sizeMap pilote la hauteur effective → le bloc suivant suit la hauteur mesurée", () => {
    // Coeur du chantier 1 : si B mesure 80 (au lieu de 40), C descend en
    // conséquence. C'est la propriété que sizeToContent (Phase 1) exploite.
    const map = computeAutoLayoutPositions(
      group({ mode: "column", gap: 10, justify: "start", align: "top" }),
      columnBlocks(),
      sizes({ b: { width: 100, height: 80 } }),
    );
    expect(pos(map, "a")).toEqual({ x: 0, y: 0 });
    expect(pos(map, "b")).toEqual({ x: 0, y: 30 });
    expect(pos(map, "c")).toEqual({ x: 0, y: 120 });
  });

  it("anchorBlockId (justify center) → ancre le bloc pivot, les autres s'empilent autour", () => {
    const map = computeAutoLayoutPositions(
      group({ mode: "column", gap: 10, justify: "center", align: "top", height: 200, anchorBlockId: "b" }),
      columnBlocks(),
    );
    expect(pos(map, "a")).toEqual({ x: 0, y: 50 });
    expect(pos(map, "b")).toEqual({ x: 0, y: 80 });
    expect(pos(map, "c")).toEqual({ x: 0, y: 130 });
  });
});

// ──────────────────────────────────────────────────────────────────────────
// computeAutoLayoutPositions — ligne
// ──────────────────────────────────────────────────────────────────────────

describe("computeAutoLayoutPositions — ligne", () => {
  it("justify start align top → côte à côte depuis la gauche", () => {
    const blocks: AnyBlock[] = [
      text("a", { x: 0, y: 0, w: 30, h: 40, z: 0 }),
      text("b", { x: 40, y: 0, w: 50, h: 40, z: 1 }),
      text("c", { x: 100, y: 0, w: 20, h: 40, z: 2 }),
    ];
    const map = computeAutoLayoutPositions(
      group({ mode: "row", gap: 10, justify: "start", align: "top" }),
      blocks,
    );
    expect(pos(map, "a")).toEqual({ x: 0, y: 0 });
    expect(pos(map, "b")).toEqual({ x: 40, y: 0 });
    expect(pos(map, "c")).toEqual({ x: 100, y: 0 });
  });

  it("align middle → centrage vertical selon hauteur de chaque bloc", () => {
    const blocks: AnyBlock[] = [
      text("a", { x: 0, y: 0, w: 30, h: 40, z: 0 }),
      text("b", { x: 40, y: 0, w: 50, h: 20, z: 1 }),
    ];
    const map = computeAutoLayoutPositions(
      group({ mode: "row", gap: 10, justify: "start", align: "middle", height: 40 }),
      blocks,
    );
    expect(pos(map, "a")).toEqual({ x: 0, y: 0 });
    expect(pos(map, "b")).toEqual({ x: 40, y: 10 });
  });
});

// ──────────────────────────────────────────────────────────────────────────
// computeAutoLayoutPositions — écart négatif (chevauchement volontaire)
// ──────────────────────────────────────────────────────────────────────────

describe("computeAutoLayoutPositions — gap négatif", () => {
  it("colonne : chaque bloc remonte de |gap| sur le précédent", () => {
    const blocks: AnyBlock[] = [
      text("a", { x: 0, y: 0, w: 100, h: 20, z: 0 }),
      text("b", { x: 0, y: 30, w: 100, h: 40, z: 1 }),
      text("c", { x: 0, y: 80, w: 100, h: 20, z: 2 }),
    ];
    const map = computeAutoLayoutPositions(
      group({ mode: "column", gap: -5, justify: "start", align: "top" }),
      blocks,
    );
    expect(pos(map, "a")).toEqual({ x: 0, y: 0 });
    // a finit à y=20, b démarre 5px plus haut.
    expect(pos(map, "b")).toEqual({ x: 0, y: 15 });
    expect(pos(map, "c")).toEqual({ x: 0, y: 50 });
  });

  it("ligne : chaque bloc empiète de |gap| sur le précédent", () => {
    const blocks: AnyBlock[] = [
      text("a", { x: 0, y: 0, w: 30, h: 40, z: 0 }),
      text("b", { x: 40, y: 0, w: 50, h: 40, z: 1 }),
      text("c", { x: 100, y: 0, w: 20, h: 40, z: 2 }),
    ];
    const map = computeAutoLayoutPositions(
      group({ mode: "row", gap: -10, justify: "start", align: "top" }),
      blocks,
    );
    expect(pos(map, "a")).toEqual({ x: 0, y: 0 });
    expect(pos(map, "b")).toEqual({ x: 20, y: 0 });
    expect(pos(map, "c")).toEqual({ x: 60, y: 0 });
  });

  it("colonne ancrée : l'ancre reste en place, les voisins la chevauchent", () => {
    const blocks: AnyBlock[] = [
      text("a", { x: 0, y: 0, w: 100, h: 20, z: 0 }),
      text("b", { x: 0, y: 30, w: 100, h: 40, z: 1 }),
      text("c", { x: 0, y: 80, w: 100, h: 20, z: 2 }),
    ];
    const map = computeAutoLayoutPositions(
      group({ mode: "column", gap: -5, justify: "center", align: "top", height: 200, anchorBlockId: "b" }),
      blocks,
    );
    // L'ancre est centrée dans le cadre, indépendamment du gap.
    expect(pos(map, "b")).toEqual({ x: 0, y: 80 });
    // a finit à y=85 alors que b commence à 80 → 5px de recouvrement.
    expect(pos(map, "a")).toEqual({ x: 0, y: 65 });
    // c démarre 5px avant la fin de b (120).
    expect(pos(map, "c")).toEqual({ x: 0, y: 115 });
  });

  it("gap 0 → blocs jointifs (aucun retour au défaut 16)", () => {
    const blocks: AnyBlock[] = [
      text("a", { x: 0, y: 0, w: 100, h: 20, z: 0 }),
      text("b", { x: 0, y: 30, w: 100, h: 40, z: 1 }),
    ];
    const map = computeAutoLayoutPositions(
      group({ mode: "column", gap: 0, justify: "start", align: "top" }),
      blocks,
    );
    expect(pos(map, "b")).toEqual({ x: 0, y: 20 });
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Cas dégénérés
// ──────────────────────────────────────────────────────────────────────────

describe("computeAutoLayoutPositions — cas dégénérés", () => {
  it("mode free → map vide (pas d'auto-layout)", () => {
    const map = computeAutoLayoutPositions(group({ mode: "free" }), [text("a", { x: 0, y: 0, w: 10, h: 10 })]);
    expect(map.size).toBe(0);
  });

  it("layout absent → map vide", () => {
    const map = computeAutoLayoutPositions(group(undefined), [text("a", { x: 0, y: 0, w: 10, h: 10 })]);
    expect(map.size).toBe(0);
  });

  it("aucun bloc → map vide", () => {
    const map = computeAutoLayoutPositions(group({ mode: "column" }), []);
    expect(map.size).toBe(0);
  });

  it("un seul bloc, justify start → reste à son origine", () => {
    const map = computeAutoLayoutPositions(
      group({ mode: "column", gap: 10, justify: "start", align: "top" }),
      [text("a", { x: 5, y: 7, w: 10, h: 10 })],
    );
    expect(pos(map, "a")).toEqual({ x: 5, y: 7 });
  });

  it("autoLayoutOffsetX/Y → décale le bloc sans bouger les autres", () => {
    const a = text("a", { x: 0, y: 0, w: 100, h: 20, z: 0 });
    const b = text("b", { x: 0, y: 30, w: 100, h: 20, z: 1 });
    b.autoLayoutOffsetX = 10;
    b.autoLayoutOffsetY = -3;
    const map = computeAutoLayoutPositions(
      group({ mode: "column", gap: 10, justify: "start", align: "top" }),
      [a, b],
    );
    // a inchangé ; b décalé de (10, -3) par rapport à sa position de flux (0, 30).
    expect(pos(map, "a")).toEqual({ x: 0, y: 0 });
    expect(pos(map, "b")).toEqual({ x: 10, y: 27 });
  });
});

// ──────────────────────────────────────────────────────────────────────────
// computeAutoLayoutPositionsForTree — groupes imbriqués (1 niveau)
// ──────────────────────────────────────────────────────────────────────────

describe("computeAutoLayoutPositionsForTree", () => {
  it("colonne [ville, titre, sous-groupe ligne [tiret, surface]]", () => {
    const parent: LayerGroup = {
      id: "parent",
      name: "parent",
      layout: { mode: "column", gap: 10, justify: "start", align: "top" },
    };
    const sub: LayerGroup = {
      id: "sub",
      name: "sub",
      parentGroupId: "parent",
      layout: { mode: "row", gap: 5, justify: "start", align: "top" },
    };
    const blocks: AnyBlock[] = [
      text("a", { x: 0, y: 0, w: 100, h: 20, z: 0 }), // ville → parent
      text("b", { x: 0, y: 30, w: 100, h: 40, z: 1 }), // titre → parent
      shape("d", { x: 0, y: 90, w: 20, h: 20, z: 0 }), // tiret → sub
      text("s", { x: 30, y: 90, w: 60, h: 20, z: 1 }), // surface → sub
    ];
    blocks[0].groupId = "parent";
    blocks[1].groupId = "parent";
    blocks[2].groupId = "sub";
    blocks[3].groupId = "sub";

    const map = computeAutoLayoutPositionsForTree(parent, [parent, sub], blocks);

    // Membres directs du parent : empilés depuis le haut.
    expect(pos(map, "a")).toEqual({ x: 0, y: 0 });
    expect(pos(map, "b")).toEqual({ x: 0, y: 30 });
    // Le sous-groupe ligne est posé après le titre (y=80), et ses membres
    // restent côte à côte horizontalement à cette hauteur.
    expect(pos(map, "d")).toEqual({ x: 0, y: 80 });
    expect(pos(map, "s")).toEqual({ x: 25, y: 80 });
  });

  it("parent sans sous-groupe → identique au layout plat", () => {
    const parent: LayerGroup = {
      id: "parent",
      name: "parent",
      layout: { mode: "column", gap: 10, justify: "start", align: "top" },
    };
    const blocks: AnyBlock[] = [
      text("a", { x: 0, y: 0, w: 100, h: 20, z: 0 }),
      text("b", { x: 0, y: 30, w: 100, h: 40, z: 1 }),
    ];
    blocks[0].groupId = "parent";
    blocks[1].groupId = "parent";

    const tree = computeAutoLayoutPositionsForTree(parent, [parent], blocks);
    const flat = computeAutoLayoutPositions(parent, blocks);
    expect([...tree.entries()].sort()).toEqual([...flat.entries()].sort());
  });

  it("autoLayoutOffset sur un sous-groupe → décale tous ses membres ensemble", () => {
    const parent: LayerGroup = {
      id: "parent",
      name: "parent",
      layout: { mode: "column", gap: 10, justify: "start", align: "top" },
    };
    const sub: LayerGroup = {
      id: "sub",
      name: "sub",
      parentGroupId: "parent",
      autoLayoutOffsetX: 15,
      autoLayoutOffsetY: 5,
      layout: { mode: "row", gap: 5, justify: "start", align: "top" },
    };
    const blocks: AnyBlock[] = [
      text("a", { x: 0, y: 0, w: 100, h: 20, z: 0 }),
      shape("d", { x: 0, y: 40, w: 20, h: 20, z: 0 }),
      text("s", { x: 30, y: 40, w: 60, h: 20, z: 1 }),
    ];
    blocks[0].groupId = "parent";
    blocks[1].groupId = "sub";
    blocks[2].groupId = "sub";

    const base = computeAutoLayoutPositionsForTree(
      { ...parent },
      [parent, { ...sub, autoLayoutOffsetX: undefined, autoLayoutOffsetY: undefined }],
      blocks,
    );
    const offset = computeAutoLayoutPositionsForTree(parent, [parent, sub], blocks);

    // Le bloc direct (a) ne bouge pas.
    expect(offset.get("a")).toEqual(base.get("a"));
    // Les deux membres du sous-groupe sont décalés de (15, 5).
    expect(offset.get("d")).toEqual({ x: base.get("d")!.x + 15, y: base.get("d")!.y + 5 });
    expect(offset.get("s")).toEqual({ x: base.get("s")!.x + 15, y: base.get("s")!.y + 5 });
  });

  it("getChildAutoLayoutGroups ne renvoie que les sous-groupes auto-layout directs", () => {
    const parent: LayerGroup = { id: "p", name: "p", layout: { mode: "column" } };
    const subAuto: LayerGroup = { id: "s1", name: "s1", parentGroupId: "p", layout: { mode: "row" } };
    const subFree: LayerGroup = { id: "s2", name: "s2", parentGroupId: "p", layout: { mode: "free" } };
    const other: LayerGroup = { id: "s3", name: "s3", parentGroupId: "x", layout: { mode: "row" } };
    expect(getChildAutoLayoutGroups("p", [parent, subAuto, subFree, other]).map((g) => g.id)).toEqual(["s1"]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// expandGroupIdsWithChildren / buildGroupTree — sélection hiérarchique
//
// `block.groupId` pointe vers le groupe FEUILLE : un bloc déplacé dans un
// sous-groupe ne porte plus l'id du parent. Sans expansion, cocher un groupe
// parent dans un clip ou une cover ne sélectionne aucun bloc de ses
// sous-groupes — ils disparaissent du rendu final.
// ──────────────────────────────────────────────────────────────────────────

describe("expandGroupIdsWithChildren", () => {
  const P: LayerGroup = { id: "P", name: "P", layout: { mode: "column" } };
  const S1: LayerGroup = { id: "S1", name: "S1", parentGroupId: "P", layout: { mode: "row" } };
  const S2: LayerGroup = { id: "S2", name: "S2", parentGroupId: "P", layout: { mode: "free" } };
  const Q: LayerGroup = { id: "Q", name: "Q", layout: { mode: "row" } };
  const ORPH: LayerGroup = { id: "ORPH", name: "ORPH", parentGroupId: "ghost" };
  const ALL = [P, S1, S2, Q, ORPH];

  const ids = (set: Set<string>) => [...set].sort();

  it("cocher un parent inclut ses sous-groupes", () => {
    expect(ids(expandGroupIdsWithChildren(["P"], ALL))).toEqual(["P", "S1", "S2"]);
  });

  it("inclut aussi un sous-groupe en mode free (≠ getChildAutoLayoutGroups)", () => {
    expect(expandGroupIdsWithChildren(["P"], ALL).has("S2")).toBe(true);
  });

  it("un sous-groupe coché seul ne remonte pas vers son parent", () => {
    expect(ids(expandGroupIdsWithChildren(["S1"], ALL))).toEqual(["S1"]);
  });

  it("un groupe sans enfant n'aspire rien", () => {
    expect(ids(expandGroupIdsWithChildren(["Q"], ALL))).toEqual(["Q"]);
  });

  it("sélection vide → set vide (mode « clip seul » préservé)", () => {
    expect(expandGroupIdsWithChildren([], ALL).size).toBe(0);
  });

  it("template 100 % plat → set identique à l'entrée (non-régression)", () => {
    expect(ids(expandGroupIdsWithChildren(["Q"], [Q, { id: "R", name: "R" }]))).toEqual(["Q"]);
  });

  it("parent + enfant cochés explicitement → pas de doublon", () => {
    expect(ids(expandGroupIdsWithChildren(["P", "S1"], ALL))).toEqual(["P", "S1", "S2"]);
  });

  it("id périmé : n'aspire pas les groupes dont le parent n'existe plus", () => {
    const expanded = expandGroupIdsWithChildren(["ghost"], ALL);
    expect(expanded.has("ORPH")).toBe(false);
  });
});

describe("buildGroupTree", () => {
  it("rattache les sous-groupes à leur parent en préservant l'ordre", () => {
    const P: LayerGroup = { id: "P", name: "P" };
    const S1: LayerGroup = { id: "S1", name: "S1", parentGroupId: "P" };
    const Q: LayerGroup = { id: "Q", name: "Q" };
    const tree = buildGroupTree([P, S1, Q]);
    expect(tree.map((node) => node.group.id)).toEqual(["P", "Q"]);
    expect(tree[0].children.map((child) => child.id)).toEqual(["S1"]);
    expect(tree[1].children).toEqual([]);
  });

  it("un groupe dont le parent n'existe plus est promu top-level", () => {
    const ORPH: LayerGroup = { id: "ORPH", name: "ORPH", parentGroupId: "ghost" };
    expect(buildGroupTree([ORPH]).map((node) => node.group.id)).toEqual(["ORPH"]);
  });
});
