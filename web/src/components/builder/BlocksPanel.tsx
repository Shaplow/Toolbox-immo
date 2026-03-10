"use client";

import { useBuilderStore } from "@/lib/store/builderStore";
import { nanoid } from "@/lib/utils";
import type { AnyBlock, BlockType } from "@/types/template";

const BLOCK_TYPES: { type: BlockType; label: string; icon: string }[] = [
  { type: "text",   label: "Texte",      icon: "T" },
  { type: "image",  label: "Image",      icon: "🖼" },
  { type: "video",  label: "Vidéo",      icon: "🎥" },
  { type: "shape",  label: "Forme",      icon: "■" },
  { type: "dpe",    label: "DPE",        icon: "⚡" },
];

function createDefaultBlock(type: BlockType): AnyBlock {
  const base = { id: nanoid(), x: 40, y: 40, w: 200, h: 60, z: 10, animations: [] as never[] };
  switch (type) {
    case "text":   return { ...base, type: "text",   style: { fontSize: 16, color: "#1A1A1A" }, rules: {} };
    case "image":  return { ...base, type: "image",  fit: "cover", w: 300, h: 200 };
    case "video":  return { ...base, type: "video",  fit: "cover", w: 400, h: 225, placeholderColor: "#111827" };
    case "shape":  return { ...base, type: "shape",  shape: "rectangle", fillColor: "#C9A84C", w: 200, h: 80, borderRadius: 0 };
    case "dpe":    return { ...base, type: "dpe", variant: "energy", style: {}, w: 350, h: 240 };
  }
}

export function BlocksPanel() {
  const { template, addBlock, selectBlock, removeBlock, duplicateBlock, moveBlockZ, selectedBlockId } =
    useBuilderStore();

  const sortedBlocks = [...template.blocks].sort((a, b) => b.z - a.z);

  return (
    <aside className="w-full bg-white flex flex-col overflow-hidden h-full">
      {/* Add blocks */}
      <div className="p-3 border-b border-gray-100">
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

      {/* Layers */}
      <div className="flex-1 overflow-y-auto p-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Calques ({template.blocks.length})</p>
        <div className="space-y-1">
          {sortedBlocks.map((block) => {
            const isSelected = selectedBlockId === block.id;
            return (
              <div
                key={block.id}
                onClick={() => selectBlock(block.id)}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-xs transition-colors ${
                  isSelected
                    ? "bg-indigo-50 border border-indigo-200"
                    : "hover:bg-gray-50 border border-transparent"
                }`}
              >
                <span className="flex-1 truncate text-gray-700 capitalize">{block.type}-{block.id.slice(-4)}</span>
                <span className="text-gray-400 text-[10px]">z:{block.z}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Block actions when selected */}
      {selectedBlockId && (
        <div className="px-3 pb-3 pt-2 border-t border-gray-100 space-y-1">
          <div className="flex gap-1">
            <button onClick={() => moveBlockZ(selectedBlockId, "up")}   className="flex-1 text-xs py-1 border rounded hover:bg-gray-50">↑ Dessus</button>
            <button onClick={() => moveBlockZ(selectedBlockId, "down")} className="flex-1 text-xs py-1 border rounded hover:bg-gray-50">↓ Dessous</button>
          </div>
          <div className="flex gap-1">
            <button onClick={() => duplicateBlock(selectedBlockId)} className="flex-1 text-xs py-1 border rounded hover:bg-gray-50">Dupliquer</button>
            <button onClick={() => { removeBlock(selectedBlockId); }} className="flex-1 text-xs py-1 border border-red-200 text-red-500 rounded hover:bg-red-50">Suppr.</button>
          </div>
        </div>
      )}
    </aside>
  );
}
