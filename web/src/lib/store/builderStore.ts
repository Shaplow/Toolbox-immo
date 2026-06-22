import { create } from "zustand";
import type { TemplateJSON, AnyBlock, CanvasFormat, LayerGroup, SchemaField, TemplateFormSection, VideoSequenceSlot, CaptionAutoConfig } from "@/types/template";
import { emptyTemplate, defaultCanvas } from "@/types/template";
import { normalizeTemplateJSON } from "@/lib/templateNormalization";

const HISTORY_LIMIT = 50;

interface BuilderState {
  template: TemplateJSON;
  selectedBlockId: string | null;
  selectedGroupId: string | null;
  /** ID of the currently selected video sequence slot (for right-panel config). */
  selectedSlotId: string | null;
  /** IDs of blocks that are part of the current multi-selection (canvas + panel). */
  multiSelectedBlockIds: string[];
  isSaving: boolean;
  /** true dès qu'une mutation history-tracked a eu lieu depuis le dernier
   *  setTemplate (chargement) ou markSaved (sauvegarde réussie). Sert au
   *  badge "Non sauvegardé" du header et au beforeunload de BuilderClient. */
  isDirty: boolean;
  // Undo/redo history
  past: TemplateJSON[];
  future: TemplateJSON[];

  // Actions
  setTemplate: (t: TemplateJSON) => void;
  selectBlock: (id: string | null) => void;
  selectGroup: (id: string | null) => void;
  selectSlot: (id: string | null) => void;
  /** Select a block and a slot simultaneously (for timeline timing edit mode). */
  selectBoth: (blockId: string, slotId: string) => void;
  /** Atomic multi-selection: sets ids, normalises selectedGroupId, clears selectedBlockId. */
  setMultiSelection: (ids: string[]) => void;
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
  updateContentLibrary: (changes: Partial<NonNullable<TemplateJSON["contentLibrary"]>>) => void;
  updateVideoSequence: (slots: VideoSequenceSlot[] | undefined) => void;
  updateCaptionAutoConfig: (changes: Partial<CaptionAutoConfig>) => void;
  setGenerationMode: (mode: TemplateJSON["generationMode"]) => void;
  setFormat: (format: CanvasFormat) => void;
  setSchema: (schema: SchemaField[]) => void;
  setFormSections: (formSections: TemplateFormSection[]) => void;
  setSaving: (v: boolean) => void;
  /** Reset le flag isDirty (appelé après sauvegarde réussie). */
  markSaved: () => void;
  recordHistory: (snapshot: TemplateJSON) => void;
  undo: () => void;
  redo: () => void;
}

/** Push current template to past, clear future, apply fn.
 *  Marque le store comme dirty — toute mutation history-tracked compte
 *  comme un changement non sauvegardé tant que markSaved n'est pas appelé. */
function withHistory(
  get: () => BuilderState,
  set: (partial: Partial<BuilderState>) => void,
  nextTemplate: TemplateJSON
) {
  const current = get().template;
  const past = [...get().past, current].slice(-HISTORY_LIMIT);
  set({ template: nextTemplate, past, future: [], isDirty: true });
}

/** Mutation hors historique : la prop change mais ne compte ni pour undo
 *  ni pour le dirty flag (utilisé pendant un resize/drag en cours par ex.). */
function withoutHistory(
  set: (partial: Partial<BuilderState>) => void,
  nextTemplate: TemplateJSON
) {
  set({ template: nextTemplate, isDirty: true });
}

function syncAutoLayoutGroups(template: TemplateJSON): TemplateJSON {
  const blocksByGroup = new Map<string, string[]>();

  for (const block of template.blocks) {
    if (!block.groupId) continue;
    if (!blocksByGroup.has(block.groupId)) blocksByGroup.set(block.groupId, []);
    blocksByGroup.get(block.groupId)?.push(block.id);
  }

  // Les sous-groupes sont des "membres" de leur parent (pour l'ordre auto-layout).
  const childGroupsByParent = new Map<string, string[]>();
  for (const group of template.groups) {
    if (!group.parentGroupId) continue;
    if (!childGroupsByParent.has(group.parentGroupId)) childGroupsByParent.set(group.parentGroupId, []);
    childGroupsByParent.get(group.parentGroupId)?.push(group.id);
  }

  return {
    ...template,
    groups: template.groups.map((group) => {
      if (!group.layout) return group;
      const memberIds = [
        ...(blocksByGroup.get(group.id) ?? []),
        ...(childGroupsByParent.get(group.id) ?? []),
      ];
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
  selectedSlotId: null,
  multiSelectedBlockIds: [],
  isSaving: false,
  isDirty: false,
  past: [],
  future: [],

  setTemplate: (t) => set({
    template: syncAutoLayoutGroups(normalizeTemplateJSON(t)),
    past: [],
    future: [],
    selectedBlockId: null,
    selectedGroupId: null,
    selectedSlotId: null,
    multiSelectedBlockIds: [],
    isDirty: false,
  }),

  selectSlot: (id) => {
    set({ selectedSlotId: id, selectedBlockId: null, selectedGroupId: null, multiSelectedBlockIds: [] });
  },

  selectBoth: (blockId, slotId) => {
    set({ selectedBlockId: blockId, selectedSlotId: slotId, selectedGroupId: null, multiSelectedBlockIds: [blockId] });
  },

  selectBlock: (id) => {
    if (id) {
      set({ selectedBlockId: id, selectedGroupId: null, selectedSlotId: null, multiSelectedBlockIds: [id] });
    } else {
      set({ selectedBlockId: null, selectedGroupId: null, selectedSlotId: null, multiSelectedBlockIds: [] });
    }
  },

  selectGroup: (id) => {
    if (!id) {
      set({ selectedGroupId: null, selectedBlockId: null, multiSelectedBlockIds: [] });
      return;
    }
    const groupIds = new Set<string>([id, ...get().template.groups.filter((g) => g.parentGroupId === id).map((g) => g.id)]);
    const groupBlockIds = get().template.blocks
      .filter((b) => b.groupId !== undefined && groupIds.has(b.groupId))
      .map((b) => b.id);
    set({ selectedGroupId: id, selectedBlockId: null, multiSelectedBlockIds: groupBlockIds });
  },

  setMultiSelection: (ids) => {
    const allBlocks = get().template.blocks;
    let groupId: string | null = null;
    if (ids.length > 0) {
      const firstGid = allBlocks.find((b) => b.id === ids[0])?.groupId ?? null;
      if (firstGid && ids.every((id) => allBlocks.find((b) => b.id === id)?.groupId === firstGid)) {
        groupId = firstGid;
      }
    }
    set({ multiSelectedBlockIds: ids, selectedGroupId: groupId, selectedBlockId: null });
  },

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
    // Déplacer un groupe parent déplace aussi les blocs de ses sous-groupes.
    const targetGroupIds = new Set<string>([groupId, ...get().template.groups.filter((g) => g.parentGroupId === groupId).map((g) => g.id)]);
    const next = {
      ...get().template,
      blocks: get().template.blocks.map((block) => (
        block.groupId !== undefined && targetGroupIds.has(block.groupId)
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
    // Dissoudre un groupe dissout aussi ses sous-groupes ; leurs blocs sont
    // détachés (groupId undefined) plutôt que laissés orphelins.
    const removed = new Set<string>([id, ...get().template.groups.filter((g) => g.parentGroupId === id).map((g) => g.id)]);
    const next = syncAutoLayoutGroups({
      ...get().template,
      groups: get().template.groups.filter((group) => !removed.has(group.id)),
      blocks: get().template.blocks.map((block) => (
        block.groupId !== undefined && removed.has(block.groupId) ? { ...block, groupId: undefined } : block
      )),
    });
    withHistory(get, set, next);
    const selected = get().selectedGroupId;
    if (selected !== null && removed.has(selected)) set({ selectedGroupId: null });
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

  updateContentLibrary: (changes) => {
    const next = {
      ...get().template,
      contentLibrary: { ...get().template.contentLibrary, ...changes },
    };
    withHistory(get, set, next);
  },

  updateVideoSequence: (slots) => {
    const next = { ...get().template, videoSequence: slots };
    withHistory(get, set, next);
  },

  updateCaptionAutoConfig: (changes) => {
    const current = get().template.captionAutoConfig ?? { enabled: false, excludeZones: [] };
    const next = { ...get().template, captionAutoConfig: { ...current, ...changes } };
    withHistory(get, set, next);
  },

  setGenerationMode: (mode) => {
    const next = { ...get().template, generationMode: mode };
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

  markSaved: () => set({ isDirty: false }),

  recordHistory: (snapshot) => {
    if (snapshot === get().template) return;
    const past = [...get().past, snapshot].slice(-HISTORY_LIMIT);
    set({ past, future: [], isDirty: true });
  },

  undo: () => {
    const { past, template, future } = get();
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    set({
      template: prev,
      past: past.slice(0, -1),
      future: [template, ...future].slice(0, HISTORY_LIMIT),
      isDirty: true,
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
      isDirty: true,
    });
  },
}));
