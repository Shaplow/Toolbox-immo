import type { AnyBlock, GroupLayoutConfig, LayerGroup, ShapeBlock } from "@/types/template";
import { getEffectiveTextAnchorPadding } from "@/lib/textBackground";

export type AutoLayoutMode = "row" | "column";

export interface GroupBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface BlockLayoutSize {
  width: number;
  height: number;
}

export interface BlockLayoutPosition {
  x: number;
  y: number;
}

export function getEffectiveBoxOffset(block: AnyBlock, size: BlockLayoutSize): BlockLayoutPosition {
  if (block.type !== "text") return { x: 0, y: 0 };
  if (!block.style.textBackgroundEnabled && !block.style.backgroundColor) return { x: 0, y: 0 };

  const frameWidth = Math.max(0, block.w);
  const frameHeight = Math.max(0, block.h);
  const width = Math.max(0, size.width);
  const height = Math.max(0, size.height);

  let x = 0;
  if (block.style.textAlign === "center") {
    x = (frameWidth - width) / 2;
  } else if (block.style.textAlign === "right") {
    x = frameWidth - width;
  }

  let y = 0;
  if (block.style.verticalAlign === "middle") {
    y = (frameHeight - height) / 2;
  } else if (block.style.verticalAlign === "bottom") {
    y = frameHeight - height;
  }

  return {
    x: Math.round(Math.max(0, x)),
    y: Math.round(Math.max(0, y)),
  };
}

function clampAnchorOffset(value: number, max: number): number {
  if (!Number.isFinite(value)) return Math.round(max / 2);
  return Math.max(0, Math.min(Math.round(value), Math.round(max)));
}

export function getBlockAnchorOffset(block: AnyBlock, size: BlockLayoutSize): BlockLayoutPosition {
  const boxOffset = getEffectiveBoxOffset(block, size);
  const width = Math.max(0, size.width);
  const height = Math.max(0, size.height);

  if (block.type !== "text") {
    return { x: boxOffset.x + Math.round(width / 2), y: boxOffset.y + Math.round(height / 2) };
  }

  const padding = getEffectiveTextAnchorPadding(block.style);
  const paddingLeft = padding.left;
  const paddingRight = padding.right;
  const paddingTop = padding.top;
  const paddingBottom = padding.bottom;

  let x = width / 2;
  if (block.style.textAlign === "left") {
    x = paddingLeft;
  } else if (block.style.textAlign === "right") {
    x = width - paddingRight;
  }

  let y = height / 2;
  if (block.style.verticalAlign === "top") {
    y = paddingTop;
  } else if (block.style.verticalAlign === "bottom") {
    y = height - paddingBottom;
  }

  return {
    x: boxOffset.x + clampAnchorOffset(x, width),
    y: boxOffset.y + clampAnchorOffset(y, height),
  };
}

function compareBlocksForMode(mode: AutoLayoutMode, left: Pick<AnyBlock, "id" | "x" | "y" | "z">, right: Pick<AnyBlock, "id" | "x" | "y" | "z">): number {
  if (mode === "column") {
    if (left.y !== right.y) return left.y - right.y;
    if (left.x !== right.x) return left.x - right.x;
  } else {
    if (left.x !== right.x) return left.x - right.x;
    if (left.y !== right.y) return left.y - right.y;
  }
  if (left.z !== right.z) return left.z - right.z;
  return left.id.localeCompare(right.id);
}

export function getAutoLayoutMode(group: LayerGroup | undefined): AutoLayoutMode | null {
  return group?.layout?.mode === "row" || group?.layout?.mode === "column"
    ? group.layout.mode
    : null;
}

export function isAutoLayoutGroup(group: LayerGroup | undefined): boolean {
  return getAutoLayoutMode(group) !== null;
}

export function isRowLayoutGroup(group: LayerGroup | undefined): boolean {
  return getAutoLayoutMode(group) === "row";
}

export function isColumnLayoutGroup(group: LayerGroup | undefined): boolean {
  return getAutoLayoutMode(group) === "column";
}

export function getGroupBounds(blocks: Pick<AnyBlock, "x" | "y" | "w" | "h">[]): GroupBounds | null {
  if (blocks.length === 0) return null;

  const initial = {
    minX: blocks[0].x,
    minY: blocks[0].y,
    maxX: blocks[0].x + blocks[0].w,
    maxY: blocks[0].y + blocks[0].h,
  };

  const reduced = blocks.reduce((acc, block) => ({
    minX: Math.min(acc.minX, block.x),
    minY: Math.min(acc.minY, block.y),
    maxX: Math.max(acc.maxX, block.x + block.w),
    maxY: Math.max(acc.maxY, block.y + block.h),
  }), initial);

  return {
    ...reduced,
    width: reduced.maxX - reduced.minX,
    height: reduced.maxY - reduced.minY,
  };
}

export function normalizeGroupLayout(layout: GroupLayoutConfig | undefined): GroupLayoutConfig | undefined {
  if (!layout || layout.mode === undefined || layout.mode === "free") return undefined;

  const normalizedOrder = Array.from(new Set((layout.order ?? []).filter((value): value is string => typeof value === "string" && value.length > 0)));

  return {
    mode: layout.mode,
    width: layout.width !== undefined ? Math.max(1, Math.round(layout.width)) : undefined,
    height: layout.height !== undefined ? Math.max(1, Math.round(layout.height)) : undefined,
    gap: layout.gap !== undefined ? Math.max(0, Math.round(layout.gap)) : 16,
    justify: layout.justify ?? "center",
    align: layout.align ?? "top",
    order: normalizedOrder.length > 0 ? normalizedOrder : undefined,
    anchorBlockId: typeof layout.anchorBlockId === "string" && layout.anchorBlockId.length > 0
      ? layout.anchorBlockId
      : undefined,
    sizeToContent: layout.sizeToContent === true ? true : undefined,
  };
}

export function getAutoLayoutOrderedBlocks(group: LayerGroup, blocks: AnyBlock[]): AnyBlock[] {
  const mode = getAutoLayoutMode(group);
  if (!mode) return [...blocks];

  const orderMap = new Map((normalizeGroupLayout(group.layout)?.order ?? []).map((id, index) => [id, index]));

  return [...blocks].sort((left, right) => {
    const leftIndex = orderMap.get(left.id);
    const rightIndex = orderMap.get(right.id);
    if (leftIndex !== undefined || rightIndex !== undefined) {
      if (leftIndex === undefined) return 1;
      if (rightIndex === undefined) return -1;
      if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    }
    return compareBlocksForMode(mode, left, right);
  });
}

/**
 * Calcul des positions auto-layout + application du décalage fin par bloc
 * (autoLayoutOffsetX/Y). L'offset est purement cosmétique : il ne change pas le
 * flux (les autres membres ne bougent pas).
 */
export function computeAutoLayoutPositions(
  group: LayerGroup,
  blocks: AnyBlock[],
  sizeMap?: Map<string, BlockLayoutSize>
): Map<string, BlockLayoutPosition> {
  const positions = computeAutoLayoutPositionsRaw(group, blocks, sizeMap);
  for (const block of blocks) {
    const dx = block.autoLayoutOffsetX ?? 0;
    const dy = block.autoLayoutOffsetY ?? 0;
    if (dx === 0 && dy === 0) continue;
    const p = positions.get(block.id);
    if (p) positions.set(block.id, { x: p.x + dx, y: p.y + dy });
  }
  return positions;
}

function computeAutoLayoutPositionsRaw(
  group: LayerGroup,
  blocks: AnyBlock[],
  sizeMap?: Map<string, BlockLayoutSize>
): Map<string, BlockLayoutPosition> {
  const positions = new Map<string, BlockLayoutPosition>();
  const mode = getAutoLayoutMode(group);
  if (!mode || blocks.length === 0) return positions;

  const bounds = getGroupBounds(blocks);
  if (!bounds) return positions;

  const layout = normalizeGroupLayout(group.layout);
  const frameWidth = layout?.width ?? bounds.width;
  const frameHeight = layout?.height ?? bounds.height;
  const gap = layout?.gap ?? 16;
  const justify = layout?.justify ?? "center";
  const align = layout?.align ?? "top";
  const orderedBlocks = getAutoLayoutOrderedBlocks(group, blocks);
  const anchorIndex = justify === "center" && layout?.anchorBlockId
    ? orderedBlocks.findIndex((block) => block.id === layout.anchorBlockId)
    : -1;

  const widths = orderedBlocks.map((block) => Math.max(0, sizeMap?.get(block.id)?.width ?? block.w));
  const heights = orderedBlocks.map((block) => Math.max(0, sizeMap?.get(block.id)?.height ?? block.h));
  if (mode === "row") {
    if (anchorIndex >= 0) {
      const anchorOffset = getBlockAnchorOffset(orderedBlocks[anchorIndex], {
        width: widths[anchorIndex],
        height: heights[anchorIndex],
      });
      const anchorStartX = bounds.minX + Math.round(frameWidth / 2 - anchorOffset.x);
      let leftCursor = anchorStartX - gap;
      let rightCursor = anchorStartX + widths[anchorIndex] + gap;

      orderedBlocks.forEach((block, index) => {
        const width = widths[index];
        const height = heights[index];
        const boxOffset = getEffectiveBoxOffset(block, { width, height });

        let effectiveY = bounds.minY;
        if (align === "middle") {
          effectiveY += Math.round((frameHeight - height) / 2);
        } else if (align === "bottom") {
          effectiveY += Math.round(frameHeight - height);
        }

        if (index === anchorIndex) {
          positions.set(block.id, { x: Math.round(anchorStartX - boxOffset.x), y: Math.round(effectiveY - boxOffset.y) });
          return;
        }

        if (index < anchorIndex) {
          const effectiveX = leftCursor - width;
          positions.set(block.id, { x: Math.round(effectiveX - boxOffset.x), y: Math.round(effectiveY - boxOffset.y) });
          leftCursor = effectiveX - gap;
          return;
        }

        positions.set(block.id, { x: Math.round(rightCursor - boxOffset.x), y: Math.round(effectiveY - boxOffset.y) });
        rightCursor += width + gap;
      });

      return positions;
    }

    const totalWidth = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, orderedBlocks.length - 1) * gap;

    let cursorX = bounds.minX;
    if (justify === "center") {
      cursorX += Math.round((frameWidth - totalWidth) / 2);
    } else if (justify === "end") {
      cursorX += Math.round(frameWidth - totalWidth);
    }

    orderedBlocks.forEach((block, index) => {
      const width = widths[index];
      const height = heights[index];
      const boxOffset = getEffectiveBoxOffset(block, { width, height });

      let effectiveY = bounds.minY;
      if (align === "middle") {
        effectiveY += Math.round((frameHeight - height) / 2);
      } else if (align === "bottom") {
        effectiveY += Math.round(frameHeight - height);
      }

      positions.set(block.id, { x: Math.round(cursorX - boxOffset.x), y: Math.round(effectiveY - boxOffset.y) });
      cursorX += width + gap;
    });

    return positions;
  }

  if (anchorIndex >= 0) {
    const anchorOffset = getBlockAnchorOffset(orderedBlocks[anchorIndex], {
      width: widths[anchorIndex],
      height: heights[anchorIndex],
    });
    const anchorStartY = bounds.minY + Math.round(frameHeight / 2 - anchorOffset.y);
    let topCursor = anchorStartY - gap;
    let bottomCursor = anchorStartY + heights[anchorIndex] + gap;

    orderedBlocks.forEach((block, index) => {
      const width = widths[index];
      const height = heights[index];
      const boxOffset = getEffectiveBoxOffset(block, { width, height });

      let effectiveX = bounds.minX;
      if (align === "middle") {
        effectiveX += Math.round((frameWidth - width) / 2);
      } else if (align === "bottom") {
        effectiveX += Math.round(frameWidth - width);
      }

      if (index === anchorIndex) {
        positions.set(block.id, { x: Math.round(effectiveX - boxOffset.x), y: Math.round(anchorStartY - boxOffset.y) });
        return;
      }

      if (index < anchorIndex) {
        const effectiveY = topCursor - height;
        positions.set(block.id, { x: Math.round(effectiveX - boxOffset.x), y: Math.round(effectiveY - boxOffset.y) });
        topCursor = effectiveY - gap;
        return;
      }

      positions.set(block.id, { x: Math.round(effectiveX - boxOffset.x), y: Math.round(bottomCursor - boxOffset.y) });
      bottomCursor += height + gap;
    });

    return positions;
  }

  const totalHeight = heights.reduce((sum, height) => sum + height, 0) + Math.max(0, orderedBlocks.length - 1) * gap;

  let cursorY = bounds.minY;
  if (justify === "center") {
    cursorY += Math.round((frameHeight - totalHeight) / 2);
  } else if (justify === "end") {
    cursorY += Math.round(frameHeight - totalHeight);
  }

  orderedBlocks.forEach((block, index) => {
    const width = widths[index];
    const height = heights[index];
    const boxOffset = getEffectiveBoxOffset(block, { width, height });

    let effectiveX = bounds.minX;
    if (align === "middle") {
      effectiveX += Math.round((frameWidth - width) / 2);
    } else if (align === "bottom") {
      effectiveX += Math.round(frameWidth - width);
    }

    positions.set(block.id, { x: Math.round(effectiveX - boxOffset.x), y: Math.round(cursorY - boxOffset.y) });
    cursorY += height + gap;
  });

  return positions;
}

/** Sous-groupes auto-layout directs d'un groupe parent (1 niveau). */
export function getChildAutoLayoutGroups(parentId: string, groups: LayerGroup[]): LayerGroup[] {
  return groups.filter((g) => g.parentGroupId === parentId && isAutoLayoutGroup(g));
}

/** Minimum structurel d'un nœud de hiérarchie de groupes. `LayerGroup` en est un sur-ensemble. */
export type GroupNode = Pick<LayerGroup, "id" | "parentGroupId">;

/**
 * Parent effectif d'un groupe : un `parentGroupId` qui ne résout pas vers un
 * groupe existant est ignoré et le groupe traité comme top-level — même
 * convention que `templateNormalization.ts` et `BlocksPanel.tsx`.
 */
function resolvedParentId(group: GroupNode, knownIds: Set<string>): string | undefined {
  return group.parentGroupId && knownIds.has(group.parentGroupId) ? group.parentGroupId : undefined;
}

/**
 * Étend une liste d'ids de groupes avec leurs **sous-groupes directs** (1 niveau).
 *
 * `block.groupId` est plat : il pointe toujours vers le groupe FEUILLE. Un bloc
 * déplacé dans un sous-groupe ne porte donc plus l'id du parent, et tout filtre
 * du type `selectedGroupIds.includes(block.groupId)` le perd silencieusement.
 * Sémantique retenue : **cocher un parent inclut ses sous-groupes**. Ne remonte
 * volontairement pas aux ancêtres : un sous-groupe reste sélectionnable seul.
 *
 * Contrairement à `getChildAutoLayoutGroups`, on **ne filtre pas** sur
 * `isAutoLayoutGroup` : un sous-groupe en mode `free` doit lui aussi suivre son
 * parent (il n'est pas auto-layouté, mais ses blocs doivent rester visibles).
 */
export function expandGroupIdsWithChildren(groupIds: Iterable<string>, groups: readonly GroupNode[]): Set<string> {
  const expanded = new Set(groupIds);
  if (expanded.size === 0) return expanded;
  const knownIds = new Set(groups.map((group) => group.id));
  for (const group of groups) {
    const parentId = resolvedParentId(group, knownIds);
    if (parentId && expanded.has(parentId)) expanded.add(group.id);
  }
  return expanded;
}

/**
 * Arbre d'affichage des groupes (profondeur 1), ordre d'origine préservé.
 * Les groupes dont le parent n'existe plus sont promus top-level.
 */
export function buildGroupTree<T extends GroupNode>(groups: readonly T[]): { group: T; children: T[] }[] {
  const knownIds = new Set(groups.map((group) => group.id));
  return groups
    .filter((group) => !resolvedParentId(group, knownIds))
    .map((group) => ({
      group,
      children: groups.filter((candidate) => resolvedParentId(candidate, knownIds) === group.id),
    }));
}

/**
 * Bloc « virtuel » représentant un sous-groupe dans le flux de son parent : se
 * comporte comme un bloc non-texte (boxOffset {0,0}, ancre = centre).
 */
function makeVirtualGroupBlock(id: string, x: number, y: number, w: number, h: number, z: number, offsetX?: number, offsetY?: number): ShapeBlock {
  return { id, type: "shape", x, y, w, h, z, animations: [], shape: "rectangle", fillColor: "transparent", autoLayoutOffsetX: offsetX, autoLayoutOffsetY: offsetY };
}

/**
 * Layout d'un groupe parent qui peut contenir des **sous-groupes** (1 niveau).
 * Renvoie les positions absolues de TOUS les blocs de l'arbre (membres directs
 * du parent + membres des sous-groupes). Pour un parent sans sous-groupe, le
 * résultat est identique à `computeAutoLayoutPositions` (rétro-compat groupes plats).
 *
 * Algo : bottom-up pour les tailles (chaque sous-groupe est layouté en interne,
 * sa bbox devient la taille d'un bloc virtuel), puis top-down pour les positions
 * (le parent place les blocs directs + les blocs virtuels, puis on translate les
 * membres de chaque sous-groupe du delta entre sa position virtuelle et son
 * origine interne).
 */
export function computeAutoLayoutPositionsForTree(
  parentGroup: LayerGroup,
  allGroups: LayerGroup[],
  allBlocks: AnyBlock[],
  sizeMap?: Map<string, BlockLayoutSize>
): Map<string, BlockLayoutPosition> {
  const result = new Map<string, BlockLayoutPosition>();
  if (!getAutoLayoutMode(parentGroup)) return result;

  const directBlocks = allBlocks.filter((block) => block.groupId === parentGroup.id);
  const childGroups = getChildAutoLayoutGroups(parentGroup.id, allGroups);

  // Pas de sous-groupe → exactement le comportement plat.
  if (childGroups.length === 0) {
    return computeAutoLayoutPositions(parentGroup, directBlocks, sizeMap);
  }

  const sizeOf = (block: AnyBlock): BlockLayoutSize => ({
    width: Math.max(0, sizeMap?.get(block.id)?.width ?? block.w),
    height: Math.max(0, sizeMap?.get(block.id)?.height ?? block.h),
  });

  const virtualSizeMap = new Map<string, BlockLayoutSize>(sizeMap ?? []);
  const virtualBlocks: AnyBlock[] = [];
  const childInternal = new Map<string, { positions: Map<string, BlockLayoutPosition>; minX: number; minY: number }>();

  for (const child of childGroups) {
    const childMembers = allBlocks.filter((block) => block.groupId === child.id);
    if (childMembers.length === 0) continue;

    const childPositions = computeAutoLayoutPositions(child, childMembers, sizeMap);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    for (const member of childMembers) {
      const p = childPositions.get(member.id);
      if (!p) continue;
      const size = sizeOf(member);
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + size.width);
      maxY = Math.max(maxY, p.y + size.height);
      minZ = Math.min(minZ, member.z);
    }
    if (!Number.isFinite(minX)) continue;

    const frameBounds = getGroupBounds(childMembers);
    const nominalX = frameBounds?.minX ?? minX;
    const nominalY = frameBounds?.minY ?? minY;
    const bbox: BlockLayoutSize = { width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };

    virtualBlocks.push(makeVirtualGroupBlock(child.id, nominalX, nominalY, bbox.width, bbox.height, Number.isFinite(minZ) ? minZ : 0, child.autoLayoutOffsetX, child.autoLayoutOffsetY));
    virtualSizeMap.set(child.id, bbox);
    childInternal.set(child.id, { positions: childPositions, minX, minY });
  }

  const parentItems: AnyBlock[] = [...directBlocks, ...virtualBlocks];
  const parentPositions = computeAutoLayoutPositions(parentGroup, parentItems, virtualSizeMap);

  for (const block of directBlocks) {
    const p = parentPositions.get(block.id);
    if (p) result.set(block.id, p);
  }

  for (const child of childGroups) {
    const internal = childInternal.get(child.id);
    const virtualPos = parentPositions.get(child.id);
    if (!internal || !virtualPos) continue;
    const dx = virtualPos.x - internal.minX;
    const dy = virtualPos.y - internal.minY;
    internal.positions.forEach((p, blockId) => {
      result.set(blockId, { x: Math.round(p.x + dx), y: Math.round(p.y + dy) });
    });
  }

  return result;
}