"use client";

import type { TextBlock } from "@/types/template";
import { type BuilderFontEntry } from "@/lib/builderFonts";
import { ToggleSwitch } from "@/components/builder/shared/ToggleSwitch";
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
        <div className="space-y-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Max lignes</span>
            <input
              type="number"
              min={1}
              placeholder="Illimité"
              value={block.rules.maxLines ?? ""}
              onChange={(e) => onUpdateBlock(block.id, {
                rules: { ...block.rules, maxLines: e.target.value ? Number(e.target.value) : undefined },
              })}
              className="border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
            />
            <span className="text-[10px] text-muted-foreground">Laisser vide pour autoriser autant de lignes que possible.</span>
          </label>

          <ToggleSwitch
            checked={!!block.rules.shrinkToFit}
            onChange={(checked) => onUpdateBlock(block.id, {
              rules: {
                ...block.rules,
                shrinkToFit: checked,
                minFontSize: checked
                  ? (block.rules.minFontSize ?? Math.max(6, Math.round((block.style.fontSize ?? 14) * 0.6)))
                  : undefined,
              },
            })}
            label="Shrink to fit"
          />

          {block.rules.shrinkToFit && (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Taille min (pt)</span>
              <input
                type="number"
                min={1}
                step={0.5}
                value={block.rules.minFontSize ?? ""}
                onChange={(e) => onUpdateBlock(block.id, {
                  rules: { ...block.rules, minFontSize: e.target.value ? Number(e.target.value) : undefined },
                })}
                className="border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
              />
              <span className="text-[10px] text-muted-foreground">
                Le texte réduit jusqu&apos;à cette taille minimale s&apos;il ne rentre pas dans la box.
              </span>
            </label>
          )}

          <ToggleSwitch
            checked={!!block.rules.uppercase}
            onChange={(checked) => onUpdateBlock(block.id, {
              rules: { ...block.rules, uppercase: checked },
            })}
            label="Majuscules forcées"
          />
        </div>
      </Section>
    </>
  );
}
