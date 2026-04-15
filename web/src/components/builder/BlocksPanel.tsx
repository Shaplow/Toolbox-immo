"use client";

import { useMemo, useState } from "react";
import { getAutoLayoutOrderedBlocks, isAutoLayoutGroup } from "@/lib/groupLayout";
import { useBuilderStore } from "@/lib/store/builderStore";
import { nanoid } from "@/lib/utils";
import type { AnyBlock, BlockType, LayerGroup } from "@/types/template";

const BLOCK_TYPES: { type: BlockType; label: string; icon: string }[] = [
  { type: "text",   label: "Texte",      icon: "T" },
  { type: "image",  label: "Image",      icon: "🖼" },
  { type: "video",  label: "Vidéo",      icon: "🎥" },
  { type: "shape",  label: "Forme",      icon: "■" },
  { type: "dpe",    label: "DPE",        icon: "⚡" },
  { type: "music",  label: "Musique",    icon: "🎵" },
];

function createDefaultBlock(type: BlockType): AnyBlock {
  const base = {
    id: nanoid(),
    name: BLOCK_TYPES.find((blockType) => blockType.type === type)?.label,
    x: 40,
    y: 40,
    w: 200,
    h: 60,
    z: 10,
    animations: [] as never[],
  };
  switch (type) {
    case "text":   return { ...base, type: "text",   style: { fontSize: 16, color: "#1A1A1A" }, rules: {} };
    case "image":  return { ...base, type: "image",  fit: "cover", w: 300, h: 200 };
    case "video":  return { ...base, type: "video",  fit: "cover", w: 400, h: 225, placeholderColor: "#111827" };
    case "shape":  return { ...base, type: "shape",  shape: "rectangle", fillColor: "#C9A84C", w: 200, h: 80, borderRadius: 0 };
    case "dpe":    return {
      ...base,
      type: "dpe",
      variant: "energy",
      style: {},
      w: 430,
      h: 400,
      showFrame: true,
      frameColor: "#9a9a9a",
      showBackground: true,
      backgroundColor: "#ffffff",
    };
    case "music": return {
      ...base,
      type: "music",
      volume: 0.3,
      loop: true,
      fadeIn: 0,
      fadeOut: 0,
      w: 0,
      h: 0,
    };
    default: return { ...base, type: "text", style: { fontSize: 16, color: "#1A1A1A" }, rules: {} };
  }
}

function createDefaultGroup(index: number): LayerGroup {
  return {
    id: nanoid(),
    name: `Groupe ${index + 1}`,
    hidden: false,
    locked: false,
    collapsed: false,
    conditionalRules: [],
  };
}

export function BlocksPanel() {
  const {
    template,
    addBlock,
    addGroup,
    assignBlocksToGroup,
    selectBlock,
    selectGroup,
    updateBlock,
    updateGroup,
    removeBlock,
    removeGroup,
    duplicateBlock,
    moveBlockZ,
    selectedBlockId,
    selectedGroupId,
  } = useBuilderStore();
  const [draggedBlockId, setDraggedBlockId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const sortedBlocks = useMemo(() => [...template.blocks].sort((a, b) => b.z - a.z), [template.blocks]);
  const groupIds = useMemo(() => new Set(template.groups.map((group) => group.id)), [template.groups]);
  const groupedBlocks = useMemo(() => {
    const out = new Map<string, AnyBlock[]>();
    for (const group of template.groups) out.set(group.id, []);
    for (const block of sortedBlocks) {
      if (!block.groupId || !groupIds.has(block.groupId)) continue;
      out.get(block.groupId)?.push(block);
    }
    for (const group of template.groups) {
      const members = out.get(group.id) ?? [];
      out.set(group.id, isAutoLayoutGroup(group) ? getAutoLayoutOrderedBlocks(group, members) : members);
    }
    return out;
  }, [groupIds, sortedBlocks, template.groups]);
  const ungroupedBlocks = useMemo(
    () => sortedBlocks.filter((block) => !block.groupId || !groupIds.has(block.groupId)),
    [groupIds, sortedBlocks]
  );

  function handleDropOnGroup(blockId: string | null, targetGroupId?: string) {
    const resolvedBlockId = blockId ?? draggedBlockId;
    if (!resolvedBlockId) return;
    assignBlocksToGroup([resolvedBlockId], targetGroupId);
    setDraggedBlockId(null);
    setDropTarget(null);
  }

  function moveGroupMember(group: LayerGroup, blockId: string, direction: -1 | 1) {
    const members = groupedBlocks.get(group.id) ?? [];
    const order = members.map((member) => member.id);
    const index = order.indexOf(blockId);
    if (index === -1) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= order.length) return;
    const nextOrder = [...order];
    const [moved] = nextOrder.splice(index, 1);
    nextOrder.splice(nextIndex, 0, moved);
    updateGroup(group.id, { layout: { ...group.layout, mode: group.layout?.mode ?? "row", order: nextOrder } });
  }

  function renderBlockRow(block: AnyBlock, options?: { nested?: boolean; group?: LayerGroup; index?: number; total?: number }) {
    const nested = options?.nested ?? false;
    const group = options?.group;
    const index = options?.index ?? -1;
    const total = options?.total ?? 0;
    const isSelected = selectedBlockId === block.id;
    const autoLayoutGroup = group && isAutoLayoutGroup(group) ? group : null;
    const showOrdering = autoLayoutGroup !== null;
    return (
      <div
        key={block.id}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", block.id);
          setDraggedBlockId(block.id);
        }}
        onDragEnd={() => {
          setDraggedBlockId(null);
          setDropTarget(null);
        }}
        onClick={() => selectBlock(block.id)}
        className={`flex items-center gap-2 rounded-lg cursor-pointer text-xs transition-colors ${nested ? "ml-3" : ""} ${
          isSelected
            ? "bg-indigo-50 border border-indigo-200"
            : "hover:bg-gray-50 border border-transparent"
        } px-2 py-1.5`}
      >
        <span className="text-[10px] text-gray-300">•</span>
        {isSelected ? (
          <input
            type="text"
            value={block.name ?? ""}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => updateBlock(block.id, { name: e.target.value } as Partial<AnyBlock>)}
            placeholder={`${block.type}-${block.id.slice(-4)}`}
            className="flex-1 min-w-0 border border-indigo-200 bg-white rounded px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
        ) : (
          <span className={`flex-1 truncate ${block.hidden ? "text-gray-400" : "text-gray-700"}`}>
            {block.name?.trim() || `${block.type}-${block.id.slice(-4)}`}
          </span>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            updateBlock(block.id, { hidden: !block.hidden } as Partial<AnyBlock>);
          }}
          title={block.hidden ? "Afficher le bloc" : "Masquer le bloc"}
          className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] transition-colors ${
            block.hidden
              ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
              : "border-gray-200 bg-white text-gray-400 hover:border-gray-400 hover:text-gray-600"
          }`}
        >
          👁
        </button>
        {showOrdering ? (
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (!autoLayoutGroup) return;
                moveGroupMember(autoLayoutGroup, block.id, -1);
              }}
              disabled={index <= 0}
              title="Monter dans l'ordre auto-layout"
              className="shrink-0 rounded border border-gray-200 bg-white px-1 py-0.5 text-[10px] text-gray-500 hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-35 disabled:cursor-not-allowed"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (!autoLayoutGroup) return;
                moveGroupMember(autoLayoutGroup, block.id, 1);
              }}
              disabled={index >= total - 1}
              title="Descendre dans l'ordre auto-layout"
              className="shrink-0 rounded border border-gray-200 bg-white px-1 py-0.5 text-[10px] text-gray-500 hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-35 disabled:cursor-not-allowed"
            >
              ↓
            </button>
          </div>
        ) : null}
        <span className="text-gray-400 text-[10px]">z:{block.z}</span>
      </div>
    );
  }

  return (
    <aside className="w-full bg-white flex flex-col overflow-hidden h-full">
      <div className="p-3 border-b border-gray-100 space-y-2">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Ajouter un bloc</p>
          <div className="grid grid-cols-3 gap-1">
            {BLOCK_TYPES.map(({ type, label, icon }) => (
              <button
                key={type}
                onClick={() => {
                  const block = createDefaultBlock(type);
                  addBlock(block);
                  selectBlock(block.id);
                }}
                className="flex flex-col items-center justify-center p-2 rounded-lg border border-gray-100 hover:border-indigo-300 hover:bg-indigo-50 transition-colors text-xs gap-1"
              >
                <span className="text-lg">{icon}</span>
                <span className="text-gray-600">{label}</span>
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => addGroup(createDefaultGroup(template.groups.length))}
          className="w-full rounded-lg border border-dashed border-gray-300 px-3 py-2 text-xs text-gray-600 hover:border-indigo-300 hover:text-indigo-700"
        >
          + Nouveau groupe
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Calques ({template.blocks.length})</p>

        {template.groups.map((group) => {
          const blocks = groupedBlocks.get(group.id) ?? [];
          const isSelected = selectedGroupId === group.id;
          const isDropTarget = dropTarget === group.id;
          return (
            <div
              key={group.id}
              onDragOver={(event) => {
                event.preventDefault();
                if (draggedBlockId) setDropTarget(group.id);
              }}
              onDragLeave={() => {
                if (dropTarget === group.id) setDropTarget(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
                const blockId = event.dataTransfer.getData("text/plain");
                handleDropOnGroup(blockId || null, group.id);
              }}
              className={`rounded-xl border transition-colors ${
                isDropTarget
                  ? "border-indigo-400 bg-indigo-50"
                  : isSelected
                    ? "border-indigo-200 bg-indigo-50/50"
                    : "border-gray-200 bg-gray-50/60"
              }`}
            >
              <div onClick={() => selectGroup(group.id)} className="flex items-center gap-2 px-2.5 py-2 cursor-pointer">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    updateGroup(group.id, { collapsed: !group.collapsed });
                  }}
                  className="h-6 w-6 rounded-md border border-gray-200 bg-white text-[10px] text-gray-500 hover:border-indigo-300 hover:text-indigo-700"
                  title={group.collapsed ? "Déplier le groupe" : "Replier le groupe"}
                >
                  {group.collapsed ? "›" : "⌄"}
                </button>
                {isSelected ? (
                  <input
                    type="text"
                    value={group.name}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => updateGroup(group.id, { name: e.target.value })}
                    className="flex-1 min-w-0 rounded border border-indigo-200 bg-white px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                ) : (
                  <span className={`flex-1 truncate font-medium ${group.hidden ? "text-gray-400" : "text-gray-700"}`}>{group.name}</span>
                )}
                <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] text-gray-400">{blocks.length}</span>
                {selectedBlockId ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      assignBlocksToGroup([selectedBlockId], group.id);
                    }}
                    title="Ajouter le bloc sélectionné à ce groupe"
                    className="shrink-0 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] text-gray-500 hover:border-indigo-300 hover:text-indigo-700"
                  >
                    +
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    updateGroup(group.id, { hidden: !group.hidden });
                  }}
                  title={group.hidden ? "Afficher le groupe" : "Masquer le groupe"}
                  className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] transition-colors ${
                    group.hidden
                      ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                      : "border-gray-200 bg-white text-gray-400 hover:border-gray-400 hover:text-gray-600"
                  }`}
                >
                  👁
                </button>
              </div>

              {!group.collapsed && (
                <div className="px-2.5 pb-2 space-y-1">
                  {blocks.length === 0 ? (
                    <p className="ml-3 rounded-lg border border-dashed border-gray-200 px-2 py-2 text-[11px] text-gray-400">
                      Aucun calque dans ce groupe.
                    </p>
                  ) : (
                    blocks.map((block, index) => renderBlockRow(block, { nested: true, group, index, total: blocks.length }))
                  )}
                </div>
              )}
            </div>
          );
        })}

        <div
          className={`space-y-1 rounded-xl border border-dashed p-2 transition-colors ${dropTarget === "ungrouped" ? "border-indigo-400 bg-indigo-50" : "border-gray-200"}`}
          onDragOver={(event) => {
            event.preventDefault();
            if (draggedBlockId) setDropTarget("ungrouped");
          }}
          onDragLeave={() => {
            if (dropTarget === "ungrouped") setDropTarget(null);
          }}
          onDrop={(event) => {
            event.preventDefault();
            const blockId = event.dataTransfer.getData("text/plain");
            handleDropOnGroup(blockId || null, undefined);
          }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Hors groupe</p>
          {ungroupedBlocks.length > 0 ? ungroupedBlocks.map((block) => renderBlockRow(block, { nested: false })) : (
            <p className="rounded-lg border border-dashed border-gray-200 px-2 py-2 text-[11px] text-gray-400">
              Dépose un calque ici pour le sortir d&apos;un groupe.
            </p>
          )}
          {selectedBlockId ? (
            <button
              type="button"
              onClick={() => assignBlocksToGroup([selectedBlockId], undefined)}
              className="w-full rounded-lg border border-dashed border-gray-300 px-2 py-1.5 text-[11px] text-gray-500 hover:border-indigo-300 hover:text-indigo-700"
            >
              Retirer le bloc sélectionné de son groupe
            </button>
          ) : null}
        </div>
      </div>

      {selectedBlockId && (
        <div className="px-3 pb-3 pt-2 border-t border-gray-100 space-y-1">
          <div className="flex gap-1">
            <button onClick={() => moveBlockZ(selectedBlockId, "up")} className="flex-1 text-xs py-1 border rounded hover:bg-gray-50">↑ Dessus</button>
            <button onClick={() => moveBlockZ(selectedBlockId, "down")} className="flex-1 text-xs py-1 border rounded hover:bg-gray-50">↓ Dessous</button>
          </div>
          <div className="flex gap-1">
            <button onClick={() => duplicateBlock(selectedBlockId)} className="flex-1 text-xs py-1 border rounded hover:bg-gray-50">Dupliquer</button>
            <button onClick={() => { removeBlock(selectedBlockId); }} className="flex-1 text-xs py-1 border border-red-200 text-red-500 rounded hover:bg-red-50">Suppr.</button>
          </div>
        </div>
      )}

      {selectedGroupId && !selectedBlockId && (
        <div className="px-3 pb-3 pt-2 border-t border-gray-100 space-y-1">
          <div className="flex gap-1">
            <button
              onClick={() => {
                const group = template.groups.find((item) => item.id === selectedGroupId);
                if (!group) return;
                updateGroup(group.id, { collapsed: !group.collapsed });
              }}
              className="flex-1 text-xs py-1 border rounded hover:bg-gray-50"
            >
              Replier
            </button>
            <button
              onClick={() => {
                const group = template.groups.find((item) => item.id === selectedGroupId);
                if (!group) return;
                updateGroup(group.id, { hidden: !group.hidden });
              }}
              className="flex-1 text-xs py-1 border rounded hover:bg-gray-50"
            >
              Masquer
            </button>
          </div>
          <button onClick={() => { removeGroup(selectedGroupId); }} className="w-full text-xs py-1 border border-red-200 text-red-500 rounded hover:bg-red-50">Dissoudre le groupe</button>
        </div>
      )}
    </aside>
  );
}
