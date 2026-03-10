import { create } from "zustand";
import type { TemplateJSON, AnyBlock, CanvasFormat, SchemaField } from "@/types/template";
import { emptyTemplate, defaultCanvas } from "@/types/template";

const HISTORY_LIMIT = 50;

interface BuilderState {
  template: TemplateJSON;
  selectedBlockId: string | null;
  isSaving: boolean;
  // Undo/redo history
  past: TemplateJSON[];
  future: TemplateJSON[];

  // Actions
  setTemplate: (t: TemplateJSON) => void;
  selectBlock: (id: string | null) => void;
  addBlock: (block: AnyBlock) => void;
  updateBlock: (id: string, changes: Partial<AnyBlock>) => void;
  updateBlocks: (updates: { id: string; changes: Partial<AnyBlock> }[]) => void;
  removeBlock: (id: string) => void;
  duplicateBlock: (id: string) => void;
  moveBlockZ: (id: string, direction: "up" | "down") => void;
  updateCanvas: (changes: Partial<TemplateJSON["canvas"]>) => void;
  updateTheme: (changes: Partial<TemplateJSON["theme"]>) => void;
  setFormat: (format: CanvasFormat) => void;
  setSchema: (schema: SchemaField[]) => void;
  setSaving: (v: boolean) => void;
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

export const useBuilderStore = create<BuilderState>()((set, get) => ({
  template: emptyTemplate(),
  selectedBlockId: null,
  isSaving: false,
  past: [],
  future: [],

  setTemplate: (t) => set({ template: t, past: [], future: [] }),

  selectBlock: (id) => set({ selectedBlockId: id }),

  addBlock: (block) => {
    const next = {
      ...get().template,
      blocks: [...get().template.blocks, block],
    };
    withHistory(get, set, next);
  },

  updateBlock: (id, changes) => {
    const next = {
      ...get().template,
      blocks: get().template.blocks.map((b) =>
        b.id === id ? ({ ...b, ...changes } as AnyBlock) : b
      ),
    };
    withHistory(get, set, next);
  },

  updateBlocks: (updates) => {
    const map = new Map(updates.map((u) => [u.id, u.changes]));
    const next = {
      ...get().template,
      blocks: get().template.blocks.map((b) => {
        const ch = map.get(b.id);
        return ch ? ({ ...b, ...ch } as AnyBlock) : b;
      }),
    };
    withHistory(get, set, next);
  },

  removeBlock: (id) => {
    const next = {
      ...get().template,
      blocks: get().template.blocks.filter((b) => b.id !== id),
    };
    withHistory(get, set, next);
    if (get().selectedBlockId === id) set({ selectedBlockId: null });
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
    const next = {
      ...get().template,
      blocks: [...get().template.blocks, newBlock],
    };
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
    const canvas = defaultCanvas(format);
    const next = { ...get().template, canvas };
    withHistory(get, set, next);
  },

  setSchema: (schema) => {
    const next = { ...get().template, schema };
    withHistory(get, set, next);
  },

  setSaving: (v) => set({ isSaving: v }),

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
