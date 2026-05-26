"use client";

import type { TextBlock } from "@/types/template";
import { type BuilderFontEntry } from "@/lib/builderFonts";
import { Section } from "./Section";
import { StyleEditor } from "./StyleEditor";

export function TextBlockPropertiesPanel({
  block,
  globalFonts,
  onUpdateBlock,
}: {
  block: TextBlock;
  globalFonts: BuilderFontEntry[];
  onUpdateBlock: (id: string, changes: Partial<TextBlock>) => void;
}) {
  return (
    <>
      <Section label="Style">
        <StyleEditor
          style={block.style}
          globalFonts={globalFonts}
          backgroundDefaults={{ width: block.w, height: block.h }}
          onChange={(s) => onUpdateBlock(block.id, { style: { ...block.style, ...s } })}
        />
      </Section>
      <Section label="Règles texte">
        <div className="space-y-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-gray-400">Max lignes</span>
            <input type="number" min={1} placeholder="Illimite" value={block.rules.maxLines ?? ""}
              onChange={(e) => onUpdateBlock(block.id, { rules: { ...block.rules, maxLines: e.target.value ? Number(e.target.value) : undefined } })}
              className="border border-gray-200 rounded px-2 py-1"
            />
            <span className="text-[10px] text-gray-400">Laisser vide pour autoriser autant de lignes que possible.</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={!!block.rules.shrinkToFit}
              onChange={(e) => onUpdateBlock(block.id, { rules: {
                ...block.rules,
                shrinkToFit: e.target.checked,
                minFontSize: e.target.checked ? (block.rules.minFontSize ?? Math.max(6, Math.round((block.style.fontSize ?? 14) * 0.6))) : undefined,
              } })} />
            <span className="text-gray-600">Shrink to fit</span>
          </label>
          {block.rules.shrinkToFit && (
            <label className="flex flex-col gap-0.5">
              <span className="text-gray-400">Taille min (pt)</span>
              <input
                type="number"
                min={1}
                step={0.5}
                value={block.rules.minFontSize ?? ""}
                onChange={(e) => onUpdateBlock(block.id, { rules: { ...block.rules, minFontSize: e.target.value ? Number(e.target.value) : undefined } })}
                className="border border-gray-200 rounded px-2 py-1"
              />
              <span className="text-[10px] text-gray-400">Le texte réduit jusqu&apos;à cette taille minimale s&apos;il ne rentre pas dans la box.</span>
            </label>
          )}
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={!!block.rules.uppercase}
              onChange={(e) => onUpdateBlock(block.id, { rules: { ...block.rules, uppercase: e.target.checked } })} />
            <span className="text-gray-600">Majuscules</span>
          </label>
        </div>
      </Section>
    </>
  );
}
