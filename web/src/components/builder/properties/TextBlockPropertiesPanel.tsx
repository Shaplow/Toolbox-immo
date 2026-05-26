"use client";

import type { TextBlock } from "@/types/template";
import { type BuilderFontEntry } from "@/lib/builderFonts";
import { Section } from "./Section";
import { StyleEditor } from "./StyleEditor";

function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 w-full text-left"
    >
      <span
        className={[
          "relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent",
          "transition-colors duration-150",
          checked ? "bg-indigo-600" : "bg-gray-200",
        ].join(" ")}
      >
        <span
          className={[
            "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow",
            "transition-transform duration-150",
            checked ? "translate-x-4" : "translate-x-0",
          ].join(" ")}
        />
      </span>
      <span className="text-xs text-gray-600">{label}</span>
    </button>
  );
}

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
            <span className="text-xs font-medium text-gray-600">Max lignes</span>
            <input
              type="number"
              min={1}
              placeholder="Illimité"
              value={block.rules.maxLines ?? ""}
              onChange={(e) => onUpdateBlock(block.id, {
                rules: { ...block.rules, maxLines: e.target.value ? Number(e.target.value) : undefined },
              })}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
            />
            <span className="text-[10px] text-gray-400">Laisser vide pour autoriser autant de lignes que possible.</span>
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
              <span className="text-xs font-medium text-gray-600">Taille min (pt)</span>
              <input
                type="number"
                min={1}
                step={0.5}
                value={block.rules.minFontSize ?? ""}
                onChange={(e) => onUpdateBlock(block.id, {
                  rules: { ...block.rules, minFontSize: e.target.value ? Number(e.target.value) : undefined },
                })}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
              />
              <span className="text-[10px] text-gray-400">
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
