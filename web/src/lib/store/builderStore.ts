import { create } from "zustand";
import type { TemplateJSON, AnyBlock, CanvasFormat, LayerGroup, SchemaField, TemplateFormSection } from "@/types/template";
import { emptyTemplate, defaultCanvas } from "@/types/template";
import { normalizeTemplateJSON } from "@/lib/templateNormalization";

const HISTORY_LIMIT = 50;

interface BuilderState {
  template: TemplateJSON;
  selectedBlockId: string | null;
  selectedGroupId: string | null;
  isSaving: boolean;
  // Undo/redo history
  past: TemplateJSON[];
  future: TemplateJSON[];

  // Actions
  setTemplate: (t: TemplateJSON) => void;
  selectBlock: (id: string | null) => void;
  selectGroup: (id: string | null) => void;
  addBlock: (block: AnyBlock) => void;
  addGroup: (group: LayerGroup) => void;
  updateBlock: (id: string, changes: Partial<AnyBlock>, options?: { history?: boolean }) => void;
  updateBlocks: (updates: { id: string; changes: Partial<AnyBlock> }[], options?: { history?: boolean }) => void;
  updateGroup: (id: string, changes: Partial<LayerGroup>, options?: { history?: boolean }) => void;
  assignBlocksToGroup: (blockIds: string[], groupId?: string, options?: { history?: boolean }) => void;
  moveGroupBlocks: (groupId: string, deltaX: number, deltaY: number, options?: { history?: boolean }) => void;
  removeBlock: (id: string) => void;
  removeGroup: (id: string) => void;
  duplicateBlock: (id: string) => void;
  moveBlockZ: (id: string, direction: "up" | "down") => void;
  updateCanvas: (changes: Partial<TemplateJSON["canvas"]>) => void;
  updateTheme: (changes: Partial<TemplateJSON["theme"]>) => void;
  setFormat: (format: CanvasFormat) => void;
  setSchema: (schema: SchemaField[]) => void;
  setFormSections: (formSections: TemplateFormSection[]) => void;
  setSaving: (v: boolean) => void;
  recordHistory: (snapshot: TemplateJSON) => void;
  undo: () => void;
  redo: () => void;
}

/** Push current template to past, clear future, apply fn */
function withHistory(
  get: () => BuilderState,
  set: (partial: Partial<BuilderState>) => void,
  nextTemplate: TemplateJSON
) {
  const current = get().template;
  const past = [...get().past, current].slice(-HISTORY_LIMIT);
  set({ template: nextTemplate, past, future: [] });
}

function withoutHistory(
  set: (partial: Partial<BuilderState>) => void,
  nextTemplate: TemplateJSON
) {
  set({ template: nextTemplate });
}

function syncAutoLayoutGroups(template: TemplateJSON): TemplateJSON {
  const blocksByGroup = new Map<string, string[]>();

  for (const block of template.blocks) {
    if (!block.groupId) continue;
    if (!blocksByGroup.has(block.groupId)) blocksByGroup.set(block.groupId, []);
    blocksByGroup.get(block.groupId)?.push(block.id);
  }

  return {
    ...template,
    groups: template.groups.map((group) => {
      if (!group.layout) return group;
      const memberIds = blocksByGroup.get(group.id) ?? [];
      const memberSet = new Set(memberIds);
      const existingOrder = (group.layout.order ?? []).filter((id) => memberSet.has(id));
      const missingIds = memberIds.filter((id) => !existingOrder.includes(id));
      const order = [...existingOrder, ...missingIds];
      const anchorBlockId = group.layout.anchorBlockId && memberSet.has(group.layout.anchorBlockId)
        ? group.layout.anchorBlockId
        : undefined;
      return {
        ...group,
        layout: {
          ...group.layout,
          order: order.length > 0 ? order : undefined,
          anchorBlockId,
        },
      };
    }),
  };
}

export const useBuilderStore = create<BuilderState>()((set, get) => ({
  template: emptyTemplate(),
  selectedBlockId: null,
  selectedGroupId: null,
  isSaving: false,
  past: [],
  future: [],

  setTemplate: (t) => set({ template: normalizeTemplateJSON(t), past: [], future: [], selectedBlockId: null, selectedGroupId: null }),

  selectBlock: (id) => set({ selectedBlockId: id, selectedGroupId: id ? null : get().selectedGroupId }),

  selectGroup: (id) => set({ selectedGroupId: id, selectedBlockId: id ? null : get().selectedBlockId }),

  addBlock: (block) => {
    const next = syncAutoLayoutGroups({
      ...get().template,
      blocks: [...get().template.blocks, block],
    });
    withHistory(get, set, next);
  },

  addGroup: (group) => {
    const next = syncAutoLayoutGroups({
      ...get().template,
      groups: [...get().template.groups, group],
    });
    withHistory(get, set, next);
    set({ selectedGroupId: group.id, selectedBlockId: null });
  },

  updateBlock: (id, changes, options) => {
    const next = {
      ...get().template,
      blocks: get().template.blocks.map((b) =>
        b.id === id ? ({ ...b, ...changes } as AnyBlock) : b
      ),
    };
    if (options?.history === false) {
      withoutHistory(set, next);
      return;
    }
    withHistory(get, set, next);
  },

  updateBlocks: (updates, options) => {
    const map = new Map(updates.map((u) => [u.id, u.changes]));
    const next = {
      ...get().template,
      blocks: get().template.blocks.map((b) => {
        const ch = map.get(b.id);
        return ch ? ({ ...b, ...ch } as AnyBlock) : b;
      }),
    };
    if (options?.history === false) {
      withoutHistory(set, next);
      return;
    }
    withHistory(get, set, next);
  },

  updateGroup: (id, changes, options) => {
    const next = syncAutoLayoutGroups({
      ...get().template,
      groups: get().template.groups.map((group) => (
        group.id === id ? { ...group, ...changes } : group
      )),
    });
    if (options?.history === false) {
      withoutHistory(set, next);
      return;
    }
    withHistory(get, set, next);
  },

  assignBlocksToGroup: (blockIds, groupId, options) => {
    const ids = new Set(blockIds);
    const next = syncAutoLayoutGroups({
      ...get().template,
      blocks: get().template.blocks.map((block) => (
        ids.has(block.id) ? { ...block, groupId } : block
      )),
    });
    if (options?.history === false) {
      withoutHistory(set, next);
      return;
    }
    withHistory(get, set, next);
  },

  moveGroupBlocks: (groupId, deltaX, deltaY, options) => {
    const next = {
      ...get().template,
      blocks: get().template.blocks.map((block) => (
        block.groupId === groupId
          ? { ...block, x: Math.round(block.x + deltaX), y: Math.round(block.y + deltaY) }
          : block
      )),
    };
    if (options?.history === false) {
      withoutHistory(set, next);
      return;
    }
    withHistory(get, set, next);
  },

  removeBlock: (id) => {
    const next = syncAutoLayoutGroups({
      ...get().template,
      blocks: get().template.blocks.filter((b) => b.id !== id),
    });
    withHistory(get, set, next);
    if (get().selectedBlockId === id) set({ selectedBlockId: null });
  },

  removeGroup: (id) => {
    const next = syncAutoLayoutGroups({
      ...get().template,
      groups: get().template.groups.filter((group) => group.id !== id),
      blocks: get().template.blocks.map((block) => (
        block.groupId === id ? { ...block, groupId: undefined } : block
      )),
    });
    withHistory(get, set, next);
    if (get().selectedGroupId === id) set({ selectedGroupId: null });
  },

  duplicateBlock: (id) => {
    const block = get().template.blocks.find((b) => b.id === id);
    if (!block) return;
    const newBlock: AnyBlock = {
      ...JSON.parse(JSON.stringify(block)),
      id: `${block.type}-${Date.now()}`,
      x: block.x + 20,
      y: block.y + 20,
      z: block.z + 1,
    } as AnyBlock;
    const next = syncAutoLayoutGroups({
      ...get().template,
      blocks: [...get().template.blocks, newBlock],
    });
    withHistory(get, set, next);
    set({ selectedBlockId: newBlock.id });
  },

  moveBlockZ: (id, direction) => {
    const next = {
      ...get().template,
      blocks: get().template.blocks.map((b) => {
        if (b.id !== id) return b;
        return { ...b, z: direction === "up" ? b.z + 1 : Math.max(0, b.z - 1) };
      }),
    };
    withHistory(get, set, next);
  },

  updateCanvas: (changes) => {
    const next = {
      ...get().template,
      canvas: { ...get().template.canvas, ...changes },
    };
    withHistory(get, set, next);
  },

  updateTheme: (changes) => {
    const next = {
      ...get().template,
      theme: { ...get().template.theme, ...changes },
    };
    withHistory(get, set, next);
  },

  setFormat: (format) => {
    const currentCanvas = get().template.canvas;
    const canvas = format === "CUSTOM"
      ? { ...currentCanvas, format: "CUSTOM" as const }
      : defaultCanvas(format);
    const next = { ...get().template, canvas };
    withHistory(get, set, next);
  },

  setSchema: (schema) => {
    const next = { ...get().template, schema };
    withHistory(get, set, next);
  },

  setFormSections: (formSections) => {
    const validIds = new Set(formSections.map((section) => section.id));
    const next = {
      ...get().template,
      formSections,
      schema: get().template.schema.map((field) => (
        field.sectionId && !validIds.has(field.sectionId)
          ? { ...field, sectionId: undefined }
          : field
      )),
    };
    withHistory(get, set, next);
  },

  setSaving: (v) => set({ isSaving: v }),

  recordHistory: (snapshot) => {
    if (snapshot === get().template) return;
    const past = [...get().past, snapshot].slice(-HISTORY_LIMIT);
    set({ past, future: [] });
  },

  undo: () => {
    const { past, template, future } = get();
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    set({
      template: prev,
      past: past.slice(0, -1),
      future: [template, ...future].slice(0, HISTORY_LIMIT),
    });
  },

  redo: () => {
    const { past, template, future } = get();
    if (future.length === 0) return;
    const next = future[0];
    set({
      template: next,
      past: [...past, template].slice(-HISTORY_LIMIT),
      future: future.slice(1),
    });
  },
}));
