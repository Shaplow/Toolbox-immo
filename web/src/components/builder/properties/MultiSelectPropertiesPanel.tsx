"use client";

import { useBuilderStore } from "@/lib/store/builderStore";
import type { AnyBlock } from "@/types/template";
import { Section } from "./Section";

export function MultiSelectPropertiesPanel() {
  const { template, multiSelectedBlockIds, updateBlocks } = useBuilderStore();

  const selectedBlocks = template.blocks.filter((b) => multiSelectedBlockIds.includes(b.id));
  const count = selectedBlocks.length;

  // Bounding box of current selection
  const minX = Math.min(...selectedBlocks.map((b) => b.x));
  const minY = Math.min(...selectedBlocks.map((b) => b.y));
  const maxX = Math.max(...selectedBlocks.map((b) => b.x + b.w));
  const maxY = Math.max(...selectedBlocks.map((b) => b.y + b.h));
  const bboxCenterX = (minX + maxX) / 2;
  const bboxCenterY = (minY + maxY) / 2;

  function applyAlign(changes: (b: AnyBlock) => Partial<AnyBlock>) {
    updateBlocks(selectedBlocks.map((b) => ({ id: b.id, changes: changes(b) })));
  }

  // Distribute evenly — requires ≥3 blocks
  function distributeH() {
    if (selectedBlocks.length < 3) return;
    const sorted = [...selectedBlocks].sort((a, b) => a.x - b.x);
    const totalW = sorted.reduce((s, b) => s + b.w, 0);
    const span = sorted[sorted.length - 1].x + sorted[sorted.length - 1].w - sorted[0].x;
    const gap = (span - totalW) / (sorted.length - 1);
    let cursor = sorted[0].x + sorted[0].w;
    const updates = sorted.slice(1).map((b) => {
      const x = Math.round(cursor + gap);
      cursor = x + b.w;
      return { id: b.id, changes: { x } as Partial<AnyBlock> };
    });
    updateBlocks(updates);
  }

  function distributeV() {
    if (selectedBlocks.length < 3) return;
    const sorted = [...selectedBlocks].sort((a, b) => a.y - b.y);
    const totalH = sorted.reduce((s, b) => s + b.h, 0);
    const span = sorted[sorted.length - 1].y + sorted[sorted.length - 1].h - sorted[0].y;
    const gap = (span - totalH) / (sorted.length - 1);
    let cursor = sorted[0].y + sorted[0].h;
    const updates = sorted.slice(1).map((b) => {
      const y = Math.round(cursor + gap);
      cursor = y + b.h;
      return { id: b.id, changes: { y } as Partial<AnyBlock> };
    });
    updateBlocks(updates);
  }

  const canDistribute = count >= 3;

  const alignActions: { title: string; label: string; fn: () => void }[] = [
    { title: "Aligner les bords gauches",        label: "⇤",  fn: () => applyAlign(() => ({ x: minX })) },
    { title: "Centrer horizontalement",           label: "↔",  fn: () => applyAlign((b) => ({ x: Math.round(bboxCenterX - b.w / 2) })) },
    { title: "Aligner les bords droits",          label: "⇥",  fn: () => applyAlign((b) => ({ x: maxX - b.w })) },
    { title: "Aligner les bords hauts",           label: "⇡",  fn: () => applyAlign(() => ({ y: minY })) },
    { title: "Centrer verticalement",             label: "↕",  fn: () => applyAlign((b) => ({ y: Math.round(bboxCenterY - b.h / 2) })) },
    { title: "Aligner les bords bas",             label: "⇣",  fn: () => applyAlign((b) => ({ y: maxY - b.h })) },
  ];

  const distributeActions: { title: string; label: string; fn: () => void; disabled: boolean }[] = [
    { title: canDistribute ? "Distribuer horizontalement" : "Nécessite ≥ 3 éléments", label: "⇹ H", fn: distributeH, disabled: !canDistribute },
    { title: canDistribute ? "Distribuer verticalement"   : "Nécessite ≥ 3 éléments", label: "⇹ V", fn: distributeV, disabled: !canDistribute },
  ];

  return (
    <aside className="w-64 bg-white border-l border-gray-200 flex flex-col shrink-0 overflow-y-auto">
      <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Sélection multiple
        </p>
        <span className="text-xs text-gray-400">{count} éléments</span>
      </div>

      <div className="p-4 space-y-4 text-xs">
        <Section label="Aligner">
          <div className="grid grid-cols-3 gap-1">
            {alignActions.map(({ title, label, fn }) => (
              <button
                key={title}
                type="button"
                title={title}
                onClick={fn}
                className="py-2 rounded border border-gray-200 text-sm text-gray-500 hover:border-indigo-400 hover:text-indigo-700 hover:bg-indigo-50 transition-colors"
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 leading-4 mt-1">
            Les bords gauche, centre, droite — puis haut, milieu, bas — par rapport à la sélection.
          </p>
        </Section>

        <Section label="Distribuer">
          <div className="grid grid-cols-2 gap-1">
            {distributeActions.map(({ title, label, fn, disabled }) => (
              <button
                key={title}
                type="button"
                title={title}
                onClick={fn}
                disabled={disabled}
                className="py-2 rounded border border-gray-200 text-sm text-gray-500 hover:border-indigo-400 hover:text-indigo-700 hover:bg-indigo-50 transition-colors disabled:opacity-35 disabled:cursor-not-allowed"
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 leading-4 mt-1">
            Espace égal entre les éléments (nécessite ≥ 3).
          </p>
        </Section>
      </div>
    </aside>
  );
}
