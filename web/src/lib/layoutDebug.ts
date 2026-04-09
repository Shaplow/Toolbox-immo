export interface LayoutDebugBlockSnapshot {
  blockId: string;
  groupId: string;
  sourceX: number;
  sourceY: number;
  sourceZ: number;
  finalLeft: number;
  finalTop: number;
  frameWidth: number;
  frameHeight: number;
  visibleWidth: number;
  visibleHeight: number;
  boxOffsetX: number;
  boxOffsetY: number;
  anchorOffsetX: number;
  anchorOffsetY: number;
}

export interface LayoutDebugGroupSnapshot {
  groupId: string;
  mode: "row" | "column";
  justify: "start" | "center" | "end";
  align: "top" | "middle" | "bottom";
  gap: number;
  width: number;
  height: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  anchorBlockId?: string;
  order: string[];
  memberIds: string[];
}

export interface LayoutDebugSnapshot {
  source: "builder" | "preview";
  capturedAt: string;
  blocks: LayoutDebugBlockSnapshot[];
  groups: LayoutDebugGroupSnapshot[];
}

export interface LayoutDebugBlockDiff {
  blockId: string;
  groupId: string;
  deltaLeft: number;
  deltaTop: number;
  deltaFrameWidth: number;
  deltaFrameHeight: number;
  deltaVisibleWidth: number;
  deltaVisibleHeight: number;
  deltaBoxOffsetX: number;
  deltaBoxOffsetY: number;
  deltaAnchorOffsetX: number;
  deltaAnchorOffsetY: number;
  maxAbsDelta: number;
}

function roundDebugValue(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export function createLayoutDebugStorageKey(templateId: string) {
  return `toolbox-layout-debug:${templateId}`;
}

export function diffLayoutSnapshots(
  builderSnapshot: LayoutDebugSnapshot | null,
  previewSnapshot: LayoutDebugSnapshot | null,
): LayoutDebugBlockDiff[] {
  if (!builderSnapshot || !previewSnapshot) return [];

  const previewByBlock = new Map(previewSnapshot.blocks.map((block) => [block.blockId, block]));

  return builderSnapshot.blocks
    .map((builderBlock) => {
      const previewBlock = previewByBlock.get(builderBlock.blockId);
      if (!previewBlock) return null;

      const deltaLeft = roundDebugValue(previewBlock.finalLeft - builderBlock.finalLeft);
      const deltaTop = roundDebugValue(previewBlock.finalTop - builderBlock.finalTop);
      const deltaFrameWidth = roundDebugValue(previewBlock.frameWidth - builderBlock.frameWidth);
      const deltaFrameHeight = roundDebugValue(previewBlock.frameHeight - builderBlock.frameHeight);
      const deltaVisibleWidth = roundDebugValue(previewBlock.visibleWidth - builderBlock.visibleWidth);
      const deltaVisibleHeight = roundDebugValue(previewBlock.visibleHeight - builderBlock.visibleHeight);
      const deltaBoxOffsetX = roundDebugValue(previewBlock.boxOffsetX - builderBlock.boxOffsetX);
      const deltaBoxOffsetY = roundDebugValue(previewBlock.boxOffsetY - builderBlock.boxOffsetY);
      const deltaAnchorOffsetX = roundDebugValue(previewBlock.anchorOffsetX - builderBlock.anchorOffsetX);
      const deltaAnchorOffsetY = roundDebugValue(previewBlock.anchorOffsetY - builderBlock.anchorOffsetY);
      const maxAbsDelta = Math.max(
        Math.abs(deltaLeft),
        Math.abs(deltaTop),
        Math.abs(deltaFrameWidth),
        Math.abs(deltaFrameHeight),
        Math.abs(deltaVisibleWidth),
        Math.abs(deltaVisibleHeight),
        Math.abs(deltaBoxOffsetX),
        Math.abs(deltaBoxOffsetY),
        Math.abs(deltaAnchorOffsetX),
        Math.abs(deltaAnchorOffsetY),
      );

      return {
        blockId: builderBlock.blockId,
        groupId: builderBlock.groupId,
        deltaLeft,
        deltaTop,
        deltaFrameWidth,
        deltaFrameHeight,
        deltaVisibleWidth,
        deltaVisibleHeight,
        deltaBoxOffsetX,
        deltaBoxOffsetY,
        deltaAnchorOffsetX,
        deltaAnchorOffsetY,
        maxAbsDelta,
      } satisfies LayoutDebugBlockDiff;
    })
    .filter((item): item is LayoutDebugBlockDiff => item !== null)
    .sort((left, right) => right.maxAbsDelta - left.maxAbsDelta || left.blockId.localeCompare(right.blockId));
}

export function stringifyLayoutDebugSnapshot(snapshot: LayoutDebugSnapshot | null) {
  return JSON.stringify(snapshot, null, 2);
}

export function roundLayoutDebugValue(value: number) {
  return roundDebugValue(value);
}