"use client";

import { useRef } from "react";
import { Eye, EyeOff, Lock, Unlock, Music } from "lucide-react";
import { useBuilderStore } from "@/lib/store/builderStore";
import { type BuilderFontEntry } from "@/lib/builderFonts";
import type { AnyBlock, MusicBlock } from "@/types/template";
import { Section } from "./properties/Section";
import { GroupPropertiesPanel } from "./properties/GroupPropertiesPanel";
import { MultiSelectPropertiesPanel } from "./properties/MultiSelectPropertiesPanel";
import { BlockBasePropertiesSection } from "./properties/BlockBasePropertiesSection";

export function PropertiesPanel({
  globalFonts,
  showResolvedTextPreview,
  onShowResolvedTextPreviewChange,
}: {
  globalFonts: BuilderFontEntry[];
  showResolvedTextPreview: boolean;
  onShowResolvedTextPreviewChange: (value: boolean) => void;
}) {
  const { template, selectedBlockId, selectedGroupId, multiSelectedBlockIds, updateBlock, setSchema } = useBuilderStore();
  const block = template.blocks.find((b) => b.id === selectedBlockId) ?? null;
  const group = template.groups.find((item) => item.id === selectedGroupId) ?? null;

  const prevBindingRef = useRef<string>("");

  // Group panel
  if (!block && group) {
    return <GroupPropertiesPanel group={group} />;
  }

  // Multi-selection panel (≥2 blocks, no single block or group selected)
  if (!block && !group && multiSelectedBlockIds.length >= 2) {
    return <MultiSelectPropertiesPanel />;
  }

  // Empty selection
  if (!block) {
    return (
      <aside className="w-64 bg-white border-l border-gray-200 flex flex-col shrink-0 overflow-y-auto">
        <div className="p-4 border-b border-gray-100 space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-gray-800">Aucune sélection</p>
            <p className="text-xs text-gray-500 leading-5">
              Sélectionnez un bloc ou un groupe pour éditer ses propriétés. Vous pouvez aussi naviguer plus vite dans le canvas avec les raccourcis ci-dessous.
            </p>
          </div>

          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Navigation</p>
            <div className="space-y-1.5 text-[11px] text-gray-600">
              <p><span className="font-medium text-gray-800">+</span> / <span className="font-medium text-gray-800">-</span> pour zoomer</p>
              <p><span className="font-medium text-gray-800">0</span> ou <span className="font-medium text-gray-800">F</span> pour recentrer et ajuster</p>
              <p><span className="font-medium text-gray-800">Cmd/Ctrl + molette</span> pour zoomer a la souris</p>
              <p><span className="font-medium text-gray-800">Shift + molette</span> pour le deplacement horizontal</p>
              <p><span className="font-medium text-gray-800">Fleches</span> pour scroller</p>
              <p><span className="font-medium text-gray-800">Espace + glisser</span> pour deplacer la vue</p>
            </div>
          </div>

        </div>
      </aside>
    );
  }

  // Music block (stays inline — small dedicated panel)
  if (block.type === "music") {
    const mb = block as MusicBlock;
    return (
      <aside className="w-64 bg-white border-l border-gray-200 flex flex-col shrink-0 overflow-y-auto">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide inline-flex items-center gap-1.5">
            <Music size={12} className="text-gray-400" />
            musique <span className="text-gray-300 font-normal">#{block.id.slice(-4)}</span>
          </p>
        </div>
        <div className="p-4 space-y-5 text-xs">
          <Section label="Calque">
            <label className="flex flex-col gap-0.5">
              <span className="text-gray-400 uppercase">Nom</span>
              <input
                type="text"
                value={mb.name ?? ""}
                onChange={(e) => updateBlock(mb.id, { name: e.target.value } as Partial<AnyBlock>)}
                placeholder={`musique-${mb.id.slice(-4)}`}
                className="border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </label>
          </Section>

          <div className="rounded-lg bg-indigo-50 border border-indigo-100 px-3 py-2.5 flex items-start gap-2">
            <Music size={14} className="shrink-0 text-indigo-400 mt-0.5" />
            <p className="text-[10px] text-indigo-700 leading-relaxed">
              Source, volume, fondu et bibliothèque audio → onglet <strong>Musique</strong> (panneau gauche).
            </p>
          </div>

          <Section label="Variable (upload formulaire)">
            <label className="flex flex-col gap-0.5">
              <span className="text-gray-400 uppercase">Binding</span>
              <input
                type="text"
                value={mb.binding ?? ""}
                placeholder="ex: music"
                onChange={(e) => updateBlock(mb.id, { binding: e.target.value || undefined } as Partial<AnyBlock>)}
                onFocus={() => { prevBindingRef.current = mb.binding ?? ""; }}
                onBlur={(e) => {
                  const newKey = e.target.value.trim();
                  const oldKey = prevBindingRef.current.trim();
                  if (newKey === oldKey) return;
                  let nextSchema = [...template.schema];
                  if (oldKey) {
                    const stillUsed = template.blocks.some(
                      (b) => b.id !== mb.id && b.binding === oldKey
                    );
                    if (!stillUsed) nextSchema = nextSchema.filter((f) => f.key !== oldKey);
                  }
                  if (newKey && !nextSchema.some((f) => f.key === newKey)) {
                    nextSchema.push({
                      key: newKey,
                      label: newKey.replace(/_/g, " "),
                      type: "audio",
                      required: false,
                      description: "Musique de fond (MP3 · WAV · AAC · M4A · OGG)",
                    });
                  }
                  setSchema(nextSchema);
                }}
                className="border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400 font-mono"
              />
            </label>
            <p className="text-[10px] text-gray-400 mt-1">Nom de la variable qui contiendra le fichier audio.</p>
          </Section>
        </div>
      </aside>
    );
  }

  // Generic block panel
  return (
    <aside className="w-64 bg-white border-l border-gray-200 flex flex-col shrink-0 overflow-y-auto">
      <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          {block.type} <span className="text-gray-300 font-normal">#{block.id.slice(-4)}</span>
        </p>
        <div className="flex items-center gap-1">
          <button
            onClick={() => updateBlock(block.id, { hidden: !block.hidden } as Partial<AnyBlock>)}
            title={block.hidden ? "Afficher le bloc" : "Masquer le bloc à la génération"}
            className={`shrink-0 inline-flex items-center justify-center px-1.5 py-1 rounded border transition-colors ${
              block.hidden
                ? "bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100"
                : "bg-white border-gray-200 text-gray-400 hover:border-gray-400 hover:text-gray-600"
            }`}
          >
            {block.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
          <button
            onClick={() => updateBlock(block.id, { locked: !block.locked } as Partial<AnyBlock>)}
            title={block.locked ? "Déverrouiller le bloc" : "Verrouiller le bloc"}
            className={`shrink-0 inline-flex items-center justify-center px-1.5 py-1 rounded border transition-colors ${
              block.locked
                ? "bg-indigo-50 border-indigo-300 text-indigo-700 hover:bg-indigo-100"
                : "bg-white border-gray-200 text-gray-400 hover:border-gray-400 hover:text-gray-600"
            }`}
          >
            {block.locked ? <Lock size={13} /> : <Unlock size={13} />}
          </button>
        </div>
      </div>

      <div className="p-4 space-y-5 text-xs">
        <BlockBasePropertiesSection
          block={block}
          globalFonts={globalFonts}
          showResolvedTextPreview={showResolvedTextPreview}
          onShowResolvedTextPreviewChange={onShowResolvedTextPreviewChange}
        />
      </div>
    </aside>
  );
}
