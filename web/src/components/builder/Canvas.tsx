"use client";

import { useRef, useState, useCallback, useEffect, useLayoutEffect, useMemo } from "react";
import { buildDpeSvg } from "@/lib/dpeSvg";
import { computeAutoLayoutPositions, getAutoLayoutMode, getBlockAnchorOffset, isAutoLayoutGroup, type BlockLayoutSize } from "@/lib/groupLayout";
import { buildTextShadowValue } from "@/lib/renderer/styleUtils";
import { buildSchemaPreviewData } from "@/lib/schemaFields";
import {
  PER_LINE_TEXT_GOO_ALPHA_INTERCEPT,
  PER_LINE_TEXT_GOO_ALPHA_SLOPE,
  PER_LINE_TEXT_GOO_COLOR_INTERPOLATION,
  PER_LINE_TEXT_GOO_COLOR_MATRIX,
  PER_LINE_TEXT_GOO_FILTER_REGION,
  getPerLineTextEffectiveRadius,
  getPerLineTextGooFilterBlur,
  getPerLineTextGooFilterId,
  getPerLineTextSideBridgeMetrics,
  shouldApplyPerLineTextGoo,
} from "@/lib/perLineTextBackground";
import { compileTextTemplate, resolveTextTemplate } from "@/lib/textTemplate";
import { roundLayoutDebugValue, type LayoutDebugSnapshot } from "@/lib/layoutDebug";
import { useBuilderStore } from "@/lib/store/builderStore";
import { getTextBackgroundBorderRadius, getTextBackgroundMode, getTextBackgroundPadding, getTextBackgroundSize, getTextContentPadding, isTextBackgroundEnabled } from "@/lib/textBackground";
import { resolveBlockForListing, resolveBlockState } from "@/lib/templateConditions";
import type { AnyBlock } from "@/types/template";
import { Resizable } from "re-resizable";

const GRID_SIZE = 10; // canvas units
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.1;
const KEYBOARD_SCROLL_STEP = 120;

export function Canvas({
  onLayoutDebugSnapshotChange,
  showResolvedTextPreview,
}: {
  onLayoutDebugSnapshotChange?: (snapshot: LayoutDebugSnapshot | null) => void;
  showResolvedTextPreview: boolean;
}) {
  const {
    template,
    selectedBlockId,
    selectedGroupId,
    selectBlock,
    selectGroup,
    updateBlock,
    updateBlocks,
    undo,
    redo,
    recordHistory,
  } = useBuilderStore();
  const { canvas, blocks } = template;
  const [zoom, setZoom] = useState(0.5);
  const [showGrid, setShowGrid] = useState(false);
  const [snapToGrid, setSnapToGrid] = useState(false);
  // Multi-select: set of block ids (Ctrl+click to toggle)
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set());
  const [isPanningView, setIsPanningView] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const measurementLayerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const spacePressedRef = useRef(false);
  const suppressNextClickRef = useRef(false);
  const panViewRef = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);
  const previewListing = useMemo(() => buildSchemaPreviewData(template.schema), [template.schema]);
  const groupMap = useMemo(() => new Map((template.groups ?? []).map((group) => [group.id, group])), [template.groups]);
  const [measuredAutoLayoutSizes, setMeasuredAutoLayoutSizes] = useState<Record<string, BlockLayoutSize>>({});
  const [fontMetricsVersion, setFontMetricsVersion] = useState(0);
  const previewPerLineGooFilters = useMemo(() => {
    const filters = new Map<string, { id: string; blur: number }>();

    for (const block of blocks) {
      if (block.type !== "text") continue;
      if (!isTextBackgroundEnabled(block.style)) continue;
      if (getTextBackgroundMode(block.style) !== "per-line") continue;

      const backgroundRadius = getTextBackgroundBorderRadius(block.style);
      if (!shouldApplyPerLineTextGoo(backgroundRadius)) continue;

      const id = getPerLineTextGooFilterId(backgroundRadius);
      if (filters.has(id)) continue;

      filters.set(id, {
        id,
        blur: getPerLineTextGooFilterBlur(backgroundRadius, zoom),
      });
    }

    return [...filters.values()];
  }, [blocks, zoom]);

  /** Snap a value to the nearest GRID_SIZE increment if snap is on */
  const snap = useCallback((v: number) =>
    snapToGrid ? Math.round(v / GRID_SIZE) * GRID_SIZE : Math.round(v),
    [snapToGrid]
  );

  const clampZoom = useCallback((value: number) => {
    if (!Number.isFinite(value)) return 1;
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
  }, []);

  const applyZoom = useCallback((nextZoom: number, anchor?: { clientX: number; clientY: number }) => {
    const container = scrollContainerRef.current;
    const clampedZoom = clampZoom(nextZoom);

    if (!container) {
      setZoom(clampedZoom);
      return;
    }

    const previousZoom = zoom;
    if (Math.abs(clampedZoom - previousZoom) < 0.0001) return;

    const rect = container.getBoundingClientRect();
    const offsetLeft = anchor ? anchor.clientX - rect.left : container.clientWidth / 2;
    const offsetTop = anchor ? anchor.clientY - rect.top : container.clientHeight / 2;
    const sourceX = (container.scrollLeft + offsetLeft) / previousZoom;
    const sourceY = (container.scrollTop + offsetTop) / previousZoom;

    setZoom(clampedZoom);

    requestAnimationFrame(() => {
      container.scrollLeft = sourceX * clampedZoom - offsetLeft;
      container.scrollTop = sourceY * clampedZoom - offsetTop;
    });
  }, [clampZoom, zoom]);

  const fitToScreen = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      setZoom(0.5);
      return;
    }

    const horizontalPadding = 80;
    const verticalPadding = 80;
    const availableWidth = Math.max(0, container.clientWidth - horizontalPadding);
    const availableHeight = Math.max(0, container.clientHeight - verticalPadding);
    const nextZoom = Math.min(availableWidth / canvas.width, availableHeight / canvas.height, 1);
    applyZoom(nextZoom);
  }, [applyZoom, canvas.height, canvas.width]);

  const fitToScreenRef = useRef(fitToScreen);
  useEffect(() => {
    fitToScreenRef.current = fitToScreen;
  }, [fitToScreen]);

  // Dragging state — also stores original positions of all multi-selected blocks
  const dragging = useRef<{
    id: string;
    startX: number;
    startY: number;
    origPositions: Record<string, { x: number; y: number }>;
    historyTemplate: typeof template;
  } | null>(null);

  const resizing = useRef<{
    id: string;
    origin: { x: number; y: number; w: number; h: number };
    historyTemplate: typeof template;
  } | null>(null);

  const applyResize = useCallback((
    block: AnyBlock,
    direction: string,
    deltaWidth: number,
    deltaHeight: number
  ) => {
    const normalizedDirection = direction.toLowerCase();
    const widthDelta = deltaWidth / zoom;
    const heightDelta = deltaHeight / zoom;
    const nextWidth = Math.max(0, snap(block.w + widthDelta));
    const nextHeight = Math.max(0, snap(block.h + heightDelta));
    let nextX = block.x;
    let nextY = block.y;

    if (normalizedDirection.includes("left")) {
      nextX = snap(block.x + (block.w - nextWidth));
    }
    if (normalizedDirection.includes("top")) {
      nextY = snap(block.y + (block.h - nextHeight));
    }

    return {
      x: nextX,
      y: nextY,
      w: nextWidth,
      h: nextHeight,
    } as Partial<AnyBlock>;
  }, [snap, zoom]);

  useEffect(() => {
    function isEditableTarget(target: EventTarget | null) {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
    }

    function onKeyDown(event: KeyboardEvent) {
      const editable = isEditableTarget(event.target);

      if (event.code === "Space" && !editable) {
        if (!spacePressedRef.current) setIsSpacePressed(true);
        spacePressedRef.current = true;
      }

      if (editable) return;

      const key = event.key.toLowerCase();
      const container = scrollContainerRef.current;
      const metaZoom = event.metaKey || event.ctrlKey;
      const isUndo = metaZoom && key === "z";
      if (isUndo) {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }

      if (key === "+" || key === "=") {
        event.preventDefault();
        applyZoom(zoom + ZOOM_STEP);
        return;
      }

      if (key === "-") {
        event.preventDefault();
        applyZoom(zoom - ZOOM_STEP);
        return;
      }

      if (key === "0" || key === "f") {
        event.preventDefault();
        fitToScreen();
        return;
      }

      if (!container) return;

      if (key === "arrowup") {
        event.preventDefault();
        container.scrollBy({ top: -KEYBOARD_SCROLL_STEP, behavior: "auto" });
        return;
      }

      if (key === "arrowdown") {
        event.preventDefault();
        container.scrollBy({ top: KEYBOARD_SCROLL_STEP, behavior: "auto" });
        return;
      }

      if (key === "arrowleft") {
        event.preventDefault();
        container.scrollBy({ left: -KEYBOARD_SCROLL_STEP, behavior: "auto" });
        return;
      }

      if (key === "arrowright") {
        event.preventDefault();
        container.scrollBy({ left: KEYBOARD_SCROLL_STEP, behavior: "auto" });
      }
    }

    function onKeyUp(event: KeyboardEvent) {
      if (event.code === "Space") {
        spacePressedRef.current = false;
        setIsSpacePressed(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [applyZoom, fitToScreen, redo, undo, zoom]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      fitToScreenRef.current();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [canvas.width, canvas.height]);

  useEffect(() => {
    if (typeof document === "undefined" || !("fonts" in document)) return;

    let cancelled = false;
    const fontSet = document.fonts;
    const bump = () => {
      if (cancelled) return;
      setFontMetricsVersion((current) => current + 1);
    };

    void fontSet.ready.then(() => {
      bump();
    });

    fontSet.addEventListener("loadingdone", bump);
    fontSet.addEventListener("loadingerror", bump);

    return () => {
      cancelled = true;
      fontSet.removeEventListener("loadingdone", bump);
      fontSet.removeEventListener("loadingerror", bump);
    };
  }, [template.blocks, template.theme.customFonts, template.theme.fonts.body, template.theme.fonts.heading]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, block: AnyBlock) => {
      e.stopPropagation();

      const group = block.groupId ? groupMap.get(block.groupId) : undefined;
      const isGroupSelection = Boolean(selectedGroupId && block.groupId === selectedGroupId);
      const isAutoLayoutMember = isAutoLayoutGroup(group);
      const isLocked = Boolean(block.locked || group?.locked);

      // Locked blocks: allow selection but no drag
      if (isLocked) {
        if (isGroupSelection && block.groupId) {
          selectGroup(block.groupId);
        } else {
          selectBlock(block.id);
        }
        return;
      }

      if (isAutoLayoutMember && !isGroupSelection) {
        selectBlock(block.id);
        return;
      }

      if (isGroupSelection && block.groupId) {
        const ids = blocks.filter((candidate) => candidate.groupId === block.groupId).map((candidate) => candidate.id);
        const origPositions: Record<string, { x: number; y: number }> = {};
        for (const id of ids) {
          const candidate = blocks.find((current) => current.id === id);
          if (candidate) origPositions[id] = { x: candidate.x, y: candidate.y };
        }

        setMultiSelected(new Set(ids));
        selectGroup(block.groupId);

        dragging.current = {
          id: block.id,
          startX: e.clientX,
          startY: e.clientY,
          origPositions,
          historyTemplate: useBuilderStore.getState().template,
        };

        function onMove(ev: MouseEvent) {
          if (!dragging.current) return;
          const rawDx = (ev.clientX - dragging.current.startX) / zoom;
          const rawDy = (ev.clientY - dragging.current.startY) / zoom;

          updateBlocks(
            Object.entries(dragging.current.origPositions).map(([id, orig]) => ({
              id,
              changes: {
                x: snap(orig.x + rawDx),
                y: snap(orig.y + rawDy),
              } as Partial<AnyBlock>,
            })),
            { history: false }
          );
        }

        function onUp() {
          const current = dragging.current;
          dragging.current = null;
          if (current) {
            recordHistory(current.historyTemplate);
          }
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        }

        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        return;
      }

      // --- Multi-select logic ---
      if (e.ctrlKey || e.metaKey) {
        // Toggle this block in multi-selection; keep last clicked as primary
        setMultiSelected((prev) => {
          const next = new Set(prev);
          if (next.has(block.id)) {
            next.delete(block.id);
            selectBlock(next.size > 0 ? [...next][next.size - 1] : null);
          } else {
            next.add(block.id);
            selectBlock(block.id);
          }
          return next;
        });
        return; // don't start drag on ctrl+click
      }

      // Regular click: if not already in multi-select, clear multi-select
      if (!multiSelected.has(block.id)) {
        setMultiSelected(new Set([block.id]));
      }
      selectBlock(block.id);

      // Capture original positions for all selected blocks (or just this one)
      const ids = multiSelected.has(block.id) ? [...multiSelected] : [block.id];
      const origPositions: Record<string, { x: number; y: number }> = {};
      for (const id of ids) {
        const b = blocks.find((bl) => bl.id === id);
        if (b) origPositions[id] = { x: b.x, y: b.y };
      }
      // Always include dragged block
      origPositions[block.id] = { x: block.x, y: block.y };

      dragging.current = {
        id: block.id,
        startX: e.clientX,
        startY: e.clientY,
        origPositions,
        historyTemplate: useBuilderStore.getState().template,
      };

      function onMove(ev: MouseEvent) {
        if (!dragging.current) return;
        const rawDx = (ev.clientX - dragging.current.startX) / zoom;
        const rawDy = (ev.clientY - dragging.current.startY) / zoom;

        const updates = Object.entries(dragging.current.origPositions).map(([id, orig]) => ({
          id,
          changes: {
            x: snap(orig.x + rawDx),
            y: snap(orig.y + rawDy),
          } as Partial<AnyBlock>,
        }));

        if (updates.length === 1) {
          updateBlock(updates[0].id, updates[0].changes, { history: false });
        } else {
          updateBlocks(updates, { history: false });
        }
      }

      function onUp() {
        const current = dragging.current;
        dragging.current = null;
        if (current) {
          recordHistory(current.historyTemplate);
        }
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [zoom, snap, blocks, groupMap, multiSelected, recordHistory, selectBlock, selectGroup, selectedGroupId, updateBlock, updateBlocks]
  );

  const zoomIn = () => applyZoom(zoom + ZOOM_STEP);
  const zoomOut = () => applyZoom(zoom - ZOOM_STEP);

  const sorted = [...blocks].sort((a, b) => a.z - b.z);
  const visibleResolvedBlocks = useMemo(() => {
    return sorted
      .filter((block) => block.type !== "music")
      .filter((block) => resolveBlockState(block, previewListing, block.groupId ? groupMap.get(block.groupId) : undefined).visible)
      .map((block) => {
        const group = block.groupId ? groupMap.get(block.groupId) : undefined;
        return {
          block,
          group,
          displayBlock: resolveBlockForListing(block, previewListing, group),
        };
      });
  }, [groupMap, previewListing, sorted]);

  const activeAnchorGroup = useMemo(() => {
    if (selectedGroupId) {
      const group = groupMap.get(selectedGroupId);
      if (group && isAutoLayoutGroup(group) && group.layout?.anchorBlockId && group.layout.justify === "center") {
        return group;
      }
    }

    if (selectedBlockId) {
      const selectedBlock = blocks.find((item) => item.id === selectedBlockId);
      const group = selectedBlock?.groupId ? groupMap.get(selectedBlock.groupId) : undefined;
      if (group && isAutoLayoutGroup(group) && group.layout?.anchorBlockId && group.layout.justify === "center") {
        return group;
      }
    }

    return null;
  }, [blocks, groupMap, selectedBlockId, selectedGroupId]);

  const displayedPositionMap = useMemo(() => {
    const positions = new Map<string, { x: number; y: number }>();
    const sizeMap = new Map<string, BlockLayoutSize>(Object.entries(measuredAutoLayoutSizes));

    for (const group of template.groups) {
      if (!isAutoLayoutGroup(group)) continue;
      const members = visibleResolvedBlocks
        .filter((item) => item.displayBlock.groupId === group.id)
        .map((item) => item.displayBlock);

      const layoutPositions = computeAutoLayoutPositions(group, members, sizeMap);
      layoutPositions.forEach((position, blockId) => positions.set(blockId, position));
    }

    return positions;
  }, [measuredAutoLayoutSizes, template.groups, visibleResolvedBlocks]);

  const autoLayoutMeasurementBlocks = useMemo(() => {
    return visibleResolvedBlocks.filter(({ group }) => isAutoLayoutGroup(group));
  }, [visibleResolvedBlocks]);

  useLayoutEffect(() => {
    const nextEntries: Array<[string, BlockLayoutSize]> = [];

    for (const { block } of autoLayoutMeasurementBlocks) {
      const element = measurementLayerRef.current?.querySelector<HTMLElement>(`[data-builder-measure-block-id="${block.id}"]`);
      if (!element) continue;

      const measured = element.querySelector<HTMLElement>(".block-text-background") ?? element;
      const measuredRect = measured.getBoundingClientRect();
      const fallbackRect = element.getBoundingClientRect();
      const width = measuredRect.width || fallbackRect.width || 0;
      const height = measuredRect.height || fallbackRect.height || 0;
      if (width <= 0 || height <= 0) continue;
      nextEntries.push([block.id, { width, height }]);
    }

    if (nextEntries.length === 0) return;

    const frameId = window.requestAnimationFrame(() => {
      setMeasuredAutoLayoutSizes((current) => {
        const next = { ...current };
        let changed = false;

        for (const [blockId, size] of nextEntries) {
          const prev = current[blockId];
          if (!prev || prev.width !== size.width || prev.height !== size.height) {
            next[blockId] = size;
            changed = true;
          }
        }

        return changed ? next : current;
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [autoLayoutMeasurementBlocks, fontMetricsVersion]);

  useLayoutEffect(() => {
    if (!onLayoutDebugSnapshotChange) return;

    const blockSnapshots = autoLayoutMeasurementBlocks
      .map(({ block, group, displayBlock }) => {
        const element = measurementLayerRef.current?.querySelector<HTMLElement>(`[data-builder-measure-block-id="${block.id}"]`);
        if (!element || !group) return null;

        const measured = element.querySelector<HTMLElement>(".block-text-background") ?? element;
        const measuredRect = measured.getBoundingClientRect();
        const frameRect = element.getBoundingClientRect();
        const visibleWidth = measuredRect.width || frameRect.width || 0;
        const visibleHeight = measuredRect.height || frameRect.height || 0;
        const frameWidth = frameRect.width || 0;
        const frameHeight = frameRect.height || 0;
        const layoutPosition = displayedPositionMap.get(block.id);
        const finalLeft = layoutPosition?.x ?? displayBlock.x;
        const finalTop = layoutPosition?.y ?? displayBlock.y;
        const boxOffsetX = measuredRect.left - frameRect.left;
        const boxOffsetY = measuredRect.top - frameRect.top;
        const anchorOffset = getBlockAnchorOffset(displayBlock, {
          width: visibleWidth || displayBlock.w,
          height: visibleHeight || displayBlock.h,
        });

        return {
          blockId: block.id,
          groupId: group.id,
          sourceX: roundLayoutDebugValue(displayBlock.x),
          sourceY: roundLayoutDebugValue(displayBlock.y),
          sourceZ: roundLayoutDebugValue(displayBlock.z),
          finalLeft: roundLayoutDebugValue(finalLeft),
          finalTop: roundLayoutDebugValue(finalTop),
          frameWidth: roundLayoutDebugValue(frameWidth || displayBlock.w),
          frameHeight: roundLayoutDebugValue(frameHeight || displayBlock.h),
          visibleWidth: roundLayoutDebugValue(visibleWidth || displayBlock.w),
          visibleHeight: roundLayoutDebugValue(visibleHeight || displayBlock.h),
          boxOffsetX: roundLayoutDebugValue(boxOffsetX),
          boxOffsetY: roundLayoutDebugValue(boxOffsetY),
          anchorOffsetX: roundLayoutDebugValue(anchorOffset.x),
          anchorOffsetY: roundLayoutDebugValue(anchorOffset.y),
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    const groupSnapshots = template.groups
      .filter((group) => isAutoLayoutGroup(group))
      .map((group) => {
        const members = blockSnapshots.filter((block) => block.groupId === group.id);
        if (members.length === 0) return null;

        const minX = Math.min(...members.map((item) => item.finalLeft));
        const minY = Math.min(...members.map((item) => item.finalTop));
        const maxX = Math.max(...members.map((item) => item.finalLeft + item.frameWidth));
        const maxY = Math.max(...members.map((item) => item.finalTop + item.frameHeight));
        const mode: "row" | "column" = getAutoLayoutMode(group) === "column" ? "column" : "row";

        return {
          groupId: group.id,
          mode,
          justify: group.layout?.justify ?? "center",
          align: group.layout?.align ?? "top",
          gap: roundLayoutDebugValue(group.layout?.gap ?? 16),
          width: roundLayoutDebugValue(group.layout?.width ?? Math.max(1, maxX - minX)),
          height: roundLayoutDebugValue(group.layout?.height ?? Math.max(1, maxY - minY)),
          minX: roundLayoutDebugValue(minX),
          minY: roundLayoutDebugValue(minY),
          maxX: roundLayoutDebugValue(maxX),
          maxY: roundLayoutDebugValue(maxY),
          anchorBlockId: group.layout?.anchorBlockId,
          order: [...(group.layout?.order ?? [])],
          memberIds: members.map((member) => member.blockId),
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    onLayoutDebugSnapshotChange({
      source: "builder",
      capturedAt: new Date().toISOString(),
      blocks: blockSnapshots,
      groups: groupSnapshots,
    });
  }, [autoLayoutMeasurementBlocks, displayedPositionMap, fontMetricsVersion, onLayoutDebugSnapshotChange, template.groups]);

  // Grid CSS background (scales with zoom)
  const gridStyle: React.CSSProperties = showGrid ? {
    backgroundImage:
      `linear-gradient(rgba(99,102,241,0.12) 1px, transparent 1px),` +
      `linear-gradient(90deg, rgba(99,102,241,0.12) 1px, transparent 1px)`,
    backgroundSize: `${GRID_SIZE * zoom}px ${GRID_SIZE * zoom}px`,
  } : {};

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gray-200">
      {/* Zoom + options toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-gray-100 border-b border-gray-200 shrink-0 flex-wrap">
        <button onClick={zoomOut} className="text-xs px-2 py-0.5 bg-white border rounded hover:bg-gray-50">−</button>
        <span className="text-xs text-gray-600 w-12 text-center">{Math.round(zoom * 100)}%</span>
        <button onClick={zoomIn}  className="text-xs px-2 py-0.5 bg-white border rounded hover:bg-gray-50">+</button>
        <button onClick={fitToScreen} className="text-xs px-2 py-0.5 bg-white border rounded hover:bg-gray-50">Fit</button>
        <button onClick={undo} className="text-xs px-2 py-0.5 bg-white border rounded hover:bg-gray-50">Undo</button>
        <button onClick={redo} className="text-xs px-2 py-0.5 bg-white border rounded hover:bg-gray-50">Redo</button>

        <span className="text-gray-300 mx-1">|</span>

        {/* Grid toggle */}
        <button
          onClick={() => setShowGrid((v) => !v)}
          title="Afficher/masquer la grille"
          className={`text-xs px-2 py-0.5 border rounded transition-colors ${
            showGrid ? "bg-indigo-100 border-indigo-300 text-indigo-700" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
          }`}
        >
          ⊞ Grille
        </button>

        {/* Snap toggle */}
        <button
          onClick={() => setSnapToGrid((v) => !v)}
          title="Snap to grid (10px)"
          className={`text-xs px-2 py-0.5 border rounded transition-colors ${
            snapToGrid ? "bg-indigo-100 border-indigo-300 text-indigo-700" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
          }`}
        >
          🧲 Snap
        </button>

        {/* Multi-select hint */}
        {multiSelected.size > 1 && (
          <span className="text-xs text-indigo-600 ml-2">{multiSelected.size} blocs sélectionnés</span>
        )}
      </div>

      {/* Scrollable canvas area — outer handles scroll, inner handles centering */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto"
        onWheel={(event) => {
          const container = scrollContainerRef.current;
          if (!container) return;

          if (event.metaKey || event.ctrlKey) {
            event.preventDefault();
            applyZoom(zoom + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP), {
              clientX: event.clientX,
              clientY: event.clientY,
            });
            return;
          }

          if (event.shiftKey) {
            event.preventDefault();
            container.scrollLeft += event.deltaY !== 0 ? event.deltaY : event.deltaX;
          }
        }}
        onMouseDown={(event) => {
          if (!spacePressedRef.current) return;
          const container = scrollContainerRef.current;
          if (!container) return;

          suppressNextClickRef.current = true;
          panViewRef.current = {
            startX: event.clientX,
            startY: event.clientY,
            scrollLeft: container.scrollLeft,
            scrollTop: container.scrollTop,
          };
          setIsPanningView(true);

          function onMove(moveEvent: MouseEvent) {
            const current = panViewRef.current;
            const activeContainer = scrollContainerRef.current;
            if (!current || !activeContainer) return;

            activeContainer.scrollLeft = current.scrollLeft - (moveEvent.clientX - current.startX);
            activeContainer.scrollTop = current.scrollTop - (moveEvent.clientY - current.startY);
          }

          function onUp() {
            panViewRef.current = null;
            setIsPanningView(false);
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
          }

          window.addEventListener("mousemove", onMove);
          window.addEventListener("mouseup", onUp);
        }}
        onClick={() => {
          if (suppressNextClickRef.current) {
            suppressNextClickRef.current = false;
            return;
          }
          selectBlock(null);
          selectGroup(null);
          setMultiSelected(new Set());
        }}
        style={{ cursor: isPanningView ? "grabbing" : isSpacePressed ? "grab" : "default" }}
      >
        <div className="flex items-start justify-center p-8 min-w-fit min-h-full">
        <div
          ref={canvasRef}
          style={{
            width: canvas.width * zoom,
            height: canvas.height * zoom,
            position: "relative",
            backgroundColor: canvas.backgroundColor,
            boxShadow: "0 4px 32px rgba(0,0,0,0.15)",
            overflow: "hidden",
            flexShrink: 0,
            ...gridStyle,
          }}
        >
          {/* Hidden SVG filter definitions — used by per-line text background gooey effect */}
          <svg width="0" height="0" style={{ position: "absolute", overflow: "hidden" }} aria-hidden="true">
            <defs>
              {previewPerLineGooFilters.map(({ id, blur }) => (
                <filter
                  key={id}
                  id={id}
                  colorInterpolationFilters={PER_LINE_TEXT_GOO_COLOR_INTERPOLATION}
                  x={PER_LINE_TEXT_GOO_FILTER_REGION.x}
                  y={PER_LINE_TEXT_GOO_FILTER_REGION.y}
                  width={PER_LINE_TEXT_GOO_FILTER_REGION.width}
                  height={PER_LINE_TEXT_GOO_FILTER_REGION.height}
                >
                  <feGaussianBlur in="SourceGraphic" stdDeviation={blur} result="blur" />
                  <feColorMatrix in="blur" type="matrix" values={PER_LINE_TEXT_GOO_COLOR_MATRIX} result="goo" />
                  <feComponentTransfer in="goo" result="gooSolid">
                    <feFuncA type="linear" slope={PER_LINE_TEXT_GOO_ALPHA_SLOPE} intercept={PER_LINE_TEXT_GOO_ALPHA_INTERCEPT} />
                  </feComponentTransfer>
                  <feComposite in="SourceGraphic" in2="gooSolid" operator="atop" />
                </filter>
              ))}
            </defs>
          </svg>
          {activeAnchorGroup ? (
            <div
              style={getAutoLayoutMode(activeAnchorGroup) === "column"
                ? {
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: Math.round((canvas.height * zoom) / 2),
                    borderTop: "1px dashed rgba(14,165,233,0.7)",
                    pointerEvents: "none",
                    zIndex: 999,
                  }
                : {
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    left: Math.round((canvas.width * zoom) / 2),
                    borderLeft: "1px dashed rgba(14,165,233,0.7)",
                    pointerEvents: "none",
                    zIndex: 999,
                  }}
            />
          ) : null}
          {visibleResolvedBlocks.map(({ block, group, displayBlock }) => {
            const isPrimary = selectedBlockId === block.id;
            const isMulti = multiSelected.has(block.id);
            const isGroupSelected = Boolean(selectedGroupId && block.groupId === selectedGroupId);
            const isAutoLayoutMember = isAutoLayoutGroup(group);
            const outlineColor = isPrimary ? "#F59E0B" : isGroupSelected ? "#2563EB" : isMulti ? "#818CF8" : "transparent";
            const pointerEvents = selectedBlockId && !isPrimary ? "none" : "auto";
            const isLocked = Boolean(block.locked || group?.locked);
            const layoutPosition = displayedPositionMap.get(block.id);
            const effectiveSize = measuredAutoLayoutSizes[block.id] ?? { width: displayBlock.w, height: displayBlock.h };
            const isAnchorBlock = Boolean(
              group &&
              isAutoLayoutGroup(group) &&
              group.layout?.justify === "center" &&
              group.layout?.anchorBlockId === block.id
            );
            const showAnchorIndicator = Boolean(
              isAnchorBlock &&
              activeAnchorGroup &&
              group?.id === activeAnchorGroup.id
            );
            const anchorOffset = showAnchorIndicator
              ? getBlockAnchorOffset(displayBlock, effectiveSize)
              : null;
            const wrapperStyle: React.CSSProperties = {
              position: "absolute",
              left: (layoutPosition?.x ?? displayBlock.x) * zoom,
              top: (layoutPosition?.y ?? displayBlock.y) * zoom,
              zIndex: displayBlock.z,
              cursor: isLocked || isAutoLayoutMember ? "default" : "move",
              outline: `2px solid ${outlineColor}`,
              outlineOffset: "1px",
              pointerEvents,
              transform: displayBlock.rotation ? `rotate(${displayBlock.rotation}deg)` : undefined,
              transformOrigin: "center center",
            };

            if (isAutoLayoutMember) {
              return (
                <div
                  key={block.id}
                  data-builder-block-id={block.id}
                  style={{
                    ...wrapperStyle,
                    width: displayBlock.w * zoom,
                    height: displayBlock.h * zoom,
                  }}
                >
                  <BlockPreview
                    block={displayBlock}
                    autoLayout={true}
                    fontMetricsVersion={fontMetricsVersion}
                    preferPrintUnits={false}
                    previewListing={previewListing}
                    schema={template.schema}
                    showResolvedTextPreview={showResolvedTextPreview}
                    zoom={zoom}
                    defaultFontFamily={template.theme.fonts.body.family}
                    defaultTextColor={template.theme.palette.text}
                    onMouseDown={(e) => handleMouseDown(e, block)}
                  />
                  {isLocked && (
                    <div style={{
                      position: "absolute", top: 2, right: 2,
                      background: "rgba(0,0,0,0.45)", borderRadius: 3,
                      padding: "1px 3px", fontSize: 9, color: "#fff",
                      pointerEvents: "none", lineHeight: 1.2,
                    }}>🔒</div>
                  )}
                  {showAnchorIndicator && anchorOffset && (
                    <div style={{
                      position: "absolute",
                      left: anchorOffset.x * zoom,
                      top: anchorOffset.y * zoom,
                      transform: "translate(-50%, -50%)",
                      fontSize: Math.max(12, zoom * 16),
                      pointerEvents: "none",
                      lineHeight: 1.1,
                      filter: "drop-shadow(0 1px 2px rgba(255,255,255,0.95)) drop-shadow(0 1px 6px rgba(14,165,233,0.35))",
                    }}>⚓</div>
                  )}
                </div>
              );
            }

            return (
              <Resizable
                key={block.id}
                data-builder-block-id={block.id}
                size={{ width: displayBlock.w * zoom, height: displayBlock.h * zoom }}
                minWidth={0}
                minHeight={0}
                onResizeStart={() => {
                  resizing.current = {
                    id: block.id,
                    origin: { x: block.x, y: block.y, w: block.w, h: block.h },
                    historyTemplate: useBuilderStore.getState().template,
                  };
                }}
                onResize={(_e, dir, _ref, d) => {
                  const current = resizing.current;
                  if (!current) return;
                  updateBlock(block.id, applyResize(current.origin as AnyBlock, dir, d.width, d.height), { history: false });
                }}
                onResizeStop={(_e, dir, _ref, d) => {
                  const current = resizing.current;
                  if (!current) return;
                  updateBlock(block.id, applyResize(current.origin as AnyBlock, dir, d.width, d.height), { history: false });
                  recordHistory(current.historyTemplate);
                  resizing.current = null;
                }}
                enable={{
                  top: isPrimary && !isLocked, right: isPrimary && !isLocked,
                  bottom: isPrimary && !isLocked, left: isPrimary && !isLocked,
                  topRight: isPrimary && !isLocked, bottomRight: isPrimary && !isLocked,
                  bottomLeft: isPrimary && !isLocked, topLeft: isPrimary && !isLocked,
                }}
                style={wrapperStyle}
              >
                <BlockPreview
                  block={displayBlock}
                  autoLayout={false}
                  fontMetricsVersion={fontMetricsVersion}
                  preferPrintUnits={false}
                  previewListing={previewListing}
                  schema={template.schema}
                  showResolvedTextPreview={showResolvedTextPreview}
                  zoom={zoom}
                  defaultFontFamily={template.theme.fonts.body.family}
                  defaultTextColor={template.theme.palette.text}
                  onMouseDown={(e) => handleMouseDown(e, block)}
                />
                {isLocked && (
                  <div style={{
                    position: "absolute", top: 2, right: 2,
                    background: "rgba(0,0,0,0.45)", borderRadius: 3,
                    padding: "1px 3px", fontSize: 9, color: "#fff",
                    pointerEvents: "none", lineHeight: 1.2,
                  }}>🔒</div>
                )}
                {showAnchorIndicator && anchorOffset && (
                  <div style={{
                    position: "absolute",
                    left: anchorOffset.x * zoom,
                    top: anchorOffset.y * zoom,
                    transform: "translate(-50%, -50%)",
                    fontSize: Math.max(12, zoom * 16),
                    pointerEvents: "none",
                    lineHeight: 1.1,
                    filter: "drop-shadow(0 1px 2px rgba(255,255,255,0.95)) drop-shadow(0 1px 6px rgba(14,165,233,0.35))",
                  }}>⚓</div>
                )}
              </Resizable>
            );
          })}
        </div>
        </div>
      </div>

      <div
        ref={measurementLayerRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          left: -100000,
          top: 0,
          width: canvas.width,
          height: canvas.height,
          overflow: "hidden",
          pointerEvents: "none",
          visibility: "hidden",
        }}
      >
        {autoLayoutMeasurementBlocks.map(({ block, group, displayBlock }) => (
          <div
            key={`measure-${block.id}`}
            data-builder-measure-block-id={block.id}
            style={{
              position: "absolute",
              left: displayBlock.x,
              top: displayBlock.y,
              width: displayBlock.w,
              height: displayBlock.h,
              transform: displayBlock.rotation ? `rotate(${displayBlock.rotation}deg)` : undefined,
              transformOrigin: "center center",
            }}
          >
            <BlockPreview
              block={displayBlock}
              autoLayout={isAutoLayoutGroup(group)}
              fontMetricsVersion={fontMetricsVersion}
              preferPrintUnits={true}
              previewListing={previewListing}
              schema={template.schema}
              showResolvedTextPreview={showResolvedTextPreview}
              zoom={1}
              defaultFontFamily={template.theme.fonts.body.family}
              defaultTextColor={template.theme.palette.text}
              onMouseDown={() => undefined}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function BlockPreview({
  block,
  autoLayout: _autoLayout,
  fontMetricsVersion,
  preferPrintUnits,
  previewListing,
  schema,
  showResolvedTextPreview,
  zoom,
  defaultFontFamily,
  defaultTextColor,
  onMouseDown,
}: {
  block: AnyBlock;
  autoLayout?: boolean;
  fontMetricsVersion?: number;
  preferPrintUnits?: boolean;
  previewListing: ReturnType<typeof buildSchemaPreviewData>;
  schema: typeof useBuilderStore.getState extends () => infer T
    ? T extends { template: { schema: infer S } }
      ? S
      : never
    : never;
  showResolvedTextPreview: boolean;
  zoom: number;
  defaultFontFamily: string;
  defaultTextColor: string;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  void _autoLayout;
  const textContentRef = useRef<HTMLDivElement>(null);
  const [fittedFontSizePx, setFittedFontSizePx] = useState<number | null>(null);
  const style: React.CSSProperties = {
    width: "100%",
    height: "100%",
    overflow: "hidden",
    userSelect: "none",
    fontSize: zoom * 12,
  };

  const baseTextFontSizePx = block.type === "text"
    ? (block.style.fontSize ?? 14) * (4 / 3) * zoom
    : null;

  useLayoutEffect(() => {
    if (block.type !== "text") return;

    const contentNode = textContentRef.current;
    const baseFontSize = baseTextFontSizePx;
    if (!contentNode || !baseFontSize) return;

    if (!block.rules.shrinkToFit || !block.rules.minFontSize) return;

    const backgroundEnabled = isTextBackgroundEnabled(block.style);
    const backgroundMode = getTextBackgroundMode(block.style);
    const backgroundSize = getTextBackgroundSize(block.style, block.w, block.h);
      const backgroundPadding = getTextBackgroundPadding(block.style);
      const fitWidth = backgroundEnabled && backgroundMode === "fixed"
        ? backgroundSize.width - backgroundPadding.left - backgroundPadding.right
        : block.w - (backgroundEnabled ? backgroundPadding.left + backgroundPadding.right : 0);
      const fitHeight = backgroundEnabled && backgroundMode === "fixed"
        ? backgroundSize.height - backgroundPadding.top - backgroundPadding.bottom
        : block.h - (backgroundEnabled ? backgroundPadding.top + backgroundPadding.bottom : 0);
      const availableWidth = Math.max(0, fitWidth) * zoom;
      const availableHeight = Math.max(0, fitHeight) * zoom;
    const minFontSizePx = block.rules.minFontSize * (4 / 3) * zoom;
    const step = Math.max(0.5, zoom * 0.5);
    let nextFontSize = baseFontSize;

    contentNode.style.fontSize = `${baseFontSize}px`;
    while (nextFontSize > minFontSizePx) {
      const overflowsHeight = contentNode.scrollHeight - 0.5 > availableHeight;
      const overflowsWidth = contentNode.scrollWidth - 0.5 > availableWidth;
      if (!overflowsHeight && !overflowsWidth) break;

      nextFontSize = Math.max(minFontSizePx, nextFontSize - step);
      contentNode.style.fontSize = `${nextFontSize}px`;
    }

    const frameId = window.requestAnimationFrame(() => {
      setFittedFontSizePx(nextFontSize);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [baseTextFontSizePx, block, fontMetricsVersion, zoom]);

  let content: React.ReactNode;

  switch (block.type) {
    case "text": {
      const formulaContent = block.content
        ?? (block.contentSegments ? compileTextTemplate(block.contentSegments) : undefined)
        ?? (block.binding ? `{{${block.binding}}}` : block.staticText ?? "");
      const displayContent = showResolvedTextPreview
        ? resolveTextTemplate(formulaContent, previewListing, schema)
        : (block.content ?? (block.contentSegments ? compileTextTemplate(block.contentSegments) : undefined));
      const vAlign = block.style.verticalAlign ?? "top";
      const justifyContent =
        vAlign === "middle" ? "center" : vAlign === "bottom" ? "flex-end" : "flex-start";
      const backgroundEnabled = isTextBackgroundEnabled(block.style);
      const backgroundMode = getTextBackgroundMode(block.style);
      const backgroundSize = getTextBackgroundSize(block.style, block.w, block.h);
      const contentPadding = getTextContentPadding(block.style);
      const backgroundPadding = getTextBackgroundPadding(block.style);
      const backgroundRadius = getTextBackgroundBorderRadius(block.style);
      const textFontSize = block.style.fontSize ?? 14;
      const resolvedFontSize = fittedFontSizePx ?? (preferPrintUnits ? `${textFontSize * zoom}pt` : baseTextFontSizePx ?? undefined);
      const innerTextStyle: React.CSSProperties = {
        fontFamily: block.style.fontFamily ?? defaultFontFamily,
        fontSize: resolvedFontSize,
        fontWeight: block.style.fontWeight,
        color: block.style.color ?? defaultTextColor,
        letterSpacing: block.style.letterSpacing !== undefined ? `${block.style.letterSpacing * zoom}px` : undefined,
        textShadow: buildTextShadowValue(block.style, zoom),
        textAlign: block.style.textAlign,
        textTransform: block.rules.uppercase ? "uppercase" : undefined,
        lineHeight: "normal",
        whiteSpace: "pre-wrap",
        boxSizing: "border-box",
      };

      if (contentPadding.top === contentPadding.right && contentPadding.top === contentPadding.bottom && contentPadding.top === contentPadding.left) {
        if (contentPadding.top > 0) innerTextStyle.padding = contentPadding.top * zoom;
      } else {
        innerTextStyle.paddingTop = contentPadding.top * zoom;
        innerTextStyle.paddingRight = contentPadding.right * zoom;
        innerTextStyle.paddingBottom = contentPadding.bottom * zoom;
        innerTextStyle.paddingLeft = contentPadding.left * zoom;
      }

      if (block.rules.maxLines) {
        innerTextStyle.display = "-webkit-box";
        innerTextStyle.WebkitLineClamp = block.rules.maxLines;
        innerTextStyle.WebkitBoxOrient = "vertical";
        innerTextStyle.overflow = "hidden";
      }

      if (backgroundEnabled && backgroundMode === "fixed") {
        innerTextStyle.width = "100%";
      }

      const textNode = (
        <div ref={textContentRef} className="block-text-content" style={innerTextStyle}>
          {displayContent !== undefined
            ? displayContent || <span style={{ opacity: 0.35 }}>Texte…</span>
            : block.binding
              ? `{{${block.binding}}}`
              : block.staticText || <span style={{ opacity: 0.35 }}>Texte…</span>}
        </div>
      );

      if (backgroundEnabled && backgroundMode === "per-line") {
        const vPadPx = (backgroundPadding.top + backgroundPadding.bottom) * zoom;
        const uniformPad = backgroundPadding.top === backgroundPadding.right
          && backgroundPadding.top === backgroundPadding.bottom
          && backgroundPadding.top === backgroundPadding.left;
        const textAlign = block.style.textAlign ?? "left";
        const backgroundColor = block.style.backgroundColor ?? "#FFFFFF";
        const shouldApplyPerLineGoo = shouldApplyPerLineTextGoo(backgroundRadius);
        const perLineGooFilterId = shouldApplyPerLineGoo ? getPerLineTextGooFilterId(backgroundRadius) : null;
        const effectiveBackgroundRadius = getPerLineTextEffectiveRadius(backgroundRadius) * zoom;
        const bridgeMetrics = textAlign === "left"
          ? getPerLineTextSideBridgeMetrics(effectiveBackgroundRadius, backgroundPadding.left * zoom)
          : textAlign === "right"
            ? getPerLineTextSideBridgeMetrics(effectiveBackgroundRadius, backgroundPadding.right * zoom)
            : { inset: 0, width: 0 };
        const backgroundSpanStyle: React.CSSProperties = {
          fontFamily: block.style.fontFamily ?? defaultFontFamily,
          fontSize: resolvedFontSize,
          fontWeight: block.style.fontWeight,
          color: block.style.color ?? defaultTextColor,
          letterSpacing: block.style.letterSpacing !== undefined ? `${block.style.letterSpacing * zoom}px` : undefined,
          textShadow: buildTextShadowValue(block.style, zoom),
          textTransform: block.rules.uppercase ? "uppercase" : undefined,
          textAlign: block.style.textAlign,
          lineHeight: vPadPx > 0 ? `calc(1em + ${vPadPx}px)` : "normal",
          whiteSpace: "pre-wrap",
          boxSizing: "border-box",
          backgroundColor,
          display: "inline",
          WebkitBoxDecorationBreak: "clone",
          boxDecorationBreak: "clone",
          borderRadius: effectiveBackgroundRadius > 0 ? effectiveBackgroundRadius : undefined,
          opacity: block.style.opacity,
          ...(uniformPad
            ? { padding: backgroundPadding.top > 0 ? backgroundPadding.top * zoom : undefined }
            : {
                paddingTop: backgroundPadding.top > 0 ? backgroundPadding.top * zoom : undefined,
                paddingRight: backgroundPadding.right > 0 ? backgroundPadding.right * zoom : undefined,
                paddingBottom: backgroundPadding.bottom > 0 ? backgroundPadding.bottom * zoom : undefined,
                paddingLeft: backgroundPadding.left > 0 ? backgroundPadding.left * zoom : undefined,
              }),
        };
        const textForegroundStyle: React.CSSProperties = {
          position: "relative",
        };
        const bridgeStyle: React.CSSProperties | null = bridgeMetrics.width > 0
          ? {
              position: "absolute",
              top: bridgeMetrics.inset,
              bottom: bridgeMetrics.inset,
              width: bridgeMetrics.width,
              backgroundColor,
              opacity: block.style.opacity,
              pointerEvents: "none",
              left: textAlign === "left" ? 0 : undefined,
              right: textAlign === "right" ? 0 : undefined,
            }
          : null;
        const textContent = displayContent !== undefined
          ? (displayContent || <span style={{ opacity: 0.35 }}>Texte…</span>)
          : (block.binding ? `{{${block.binding}}}` : (block.staticText || <span style={{ opacity: 0.35 }}>Texte…</span>));
        content = (
          <div style={{ ...style, display: "flex", flexDirection: "column", justifyContent, overflow: "visible" }}>
            <div
              className="block-text-align"
              style={{
                width: "100%",
                position: "relative",
                textAlign,
                filter: shouldApplyPerLineGoo && perLineGooFilterId ? `url(#${perLineGooFilterId})` : undefined,
                overflow: "visible",
              }}
            >
              {bridgeStyle ? <span aria-hidden="true" style={bridgeStyle} /> : null}
              <span ref={textContentRef} className="block-text-background block-text-content text-bg-per-line" style={backgroundSpanStyle}>
                <span style={textForegroundStyle}>{textContent}</span>
              </span>
            </div>
          </div>
        );
      } else {
        content = (
          <div
            style={{
              ...style,
              display: "flex",
              flexDirection: "column",
              justifyContent,
            }}
          >
            {backgroundEnabled ? (
              // Background box is always centered horizontally; text-align controls content inside.
              <div className="block-text-align" style={{ width: "100%", display: "flex", justifyContent: "center" }}>
                <div
                  className="block-text-background"
                  style={{
                    backgroundColor: block.style.backgroundColor ?? "#FFFFFF",
                    borderRadius: backgroundRadius > 0 ? backgroundRadius * zoom : undefined,
                    opacity: block.style.opacity,
                    display: backgroundMode === "fixed" ? "flex" : "inline-flex",
                    flexDirection: "column",
                    justifyContent: backgroundMode === "fixed" ? justifyContent : undefined,
                    width: backgroundMode === "fixed" ? backgroundSize.width * zoom : "fit-content",
                    height: backgroundMode === "fixed" ? backgroundSize.height * zoom : undefined,
                    padding: backgroundPadding.top === backgroundPadding.right && backgroundPadding.top === backgroundPadding.bottom && backgroundPadding.top === backgroundPadding.left
                      ? backgroundPadding.top * zoom
                      : undefined,
                    paddingTop: backgroundPadding.top === backgroundPadding.right && backgroundPadding.top === backgroundPadding.bottom && backgroundPadding.top === backgroundPadding.left
                      ? undefined
                      : backgroundPadding.top * zoom,
                    paddingRight: backgroundPadding.top === backgroundPadding.right && backgroundPadding.top === backgroundPadding.bottom && backgroundPadding.top === backgroundPadding.left
                      ? undefined
                      : backgroundPadding.right * zoom,
                    paddingBottom: backgroundPadding.top === backgroundPadding.right && backgroundPadding.top === backgroundPadding.bottom && backgroundPadding.top === backgroundPadding.left
                      ? undefined
                      : backgroundPadding.bottom * zoom,
                    paddingLeft: backgroundPadding.top === backgroundPadding.right && backgroundPadding.top === backgroundPadding.bottom && backgroundPadding.top === backgroundPadding.left
                      ? undefined
                      : backgroundPadding.left * zoom,
                    boxSizing: "border-box",
                    maxWidth: "100%",
                    maxHeight: "100%",
                    overflow: "hidden",
                  }}
                >
                  {textNode}
                </div>
              </div>
            ) : (
              <div style={{ opacity: block.style.opacity }}>{textNode}</div>
            )}
          </div>
        );
      }
      break;
    }

    case "video":
      content = (
        <div
          style={{
            ...style,
            background: (block as import("@/types/template").VideoBlock).placeholderColor ?? "#111827",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 24 * zoom,
            color: "rgba(255,255,255,0.6)",
            flexDirection: "column",
            gap: 4 * zoom,
          }}
        >
          <span>🎥</span>
          {block.binding && <span style={{ fontSize: 10 * zoom, opacity: 0.7 }}>{block.binding}</span>}
        </div>
      );
      break;

    case "image":
      content = block.staticSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={block.staticSrc}
          alt=""
          style={{
            width: "100%",
            height: "100%",
            objectFit: block.fit ?? "cover",
            display: "block",
            pointerEvents: "none",
          }}
        />
      ) : (
        <div
          style={{
            ...style,
            background: "#E5E7EB",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 24 * zoom,
            color: "#9CA3AF",
          }}
        >
          {block.binding ? `🖼 ${block.binding}` : "🖼"}
        </div>
      );
      break;

    case "dpe":
      content = (
        <div
          style={{ ...style, overflow: "hidden", opacity: block.style.opacity }}
          dangerouslySetInnerHTML={{
            __html: buildDpeSvg({
              variant: block.variant ?? "energy",
              energyLetter: "C",
              energyValue: "180",
              climateLetter: "B",
              climateValue: "12",
              showFrame: block.showFrame,
              frameColor: block.frameColor,
              showBackground: block.showBackground,
              backgroundColor: block.backgroundColor,
            }),
          }}
        />
      );
      break;

    case "shape": {
      const CLIP: Record<string, string> = {
        rectangle: "",
        circle:    "",
        triangle:  "polygon(50% 0%, 0% 100%, 100% 100%)",
        diamond:   "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
      };
      const clip = CLIP[block.shape] ?? "";
      const br = block.shape === "circle" ? "50%" : `${(block.borderRadius ?? 0) * zoom}px`;
      content = (
        <div
          style={{
            width: "100%",
            height: "100%",
            backgroundColor: block.fillColor,
            borderRadius: br,
            border: block.borderWidth ? `${block.borderWidth * zoom}px solid ${block.borderColor ?? "transparent"}` : undefined,
            boxSizing: "border-box",
            clipPath: clip || undefined,
            opacity: block.opacity ?? 1,
          }}
        />
      );
      break;
    }
  }

  return (
    <div onMouseDown={onMouseDown} onClick={(e) => e.stopPropagation()} style={{ width: "100%", height: "100%" }}>
      {content}
    </div>
  );
}
