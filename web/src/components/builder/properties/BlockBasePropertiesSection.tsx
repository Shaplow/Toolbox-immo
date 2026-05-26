"use client";

import { useRef } from "react";
import { extractTemplateVars } from "@/lib/textTemplate";
import { useBuilderStore } from "@/lib/store/builderStore";
import type {
  AnyBlock, TextBlock, ImageBlock, VideoBlock, DPEBlock,
  ShapeBlock, SchemaField,
} from "@/types/template";
import { type BuilderFontEntry } from "@/lib/builderFonts";
import { Section } from "./Section";
import { buildAnchoredSizeChange } from "./utils";
import { BlockConditionalRulesSection } from "./BlockConditionalRulesSection";
import { ShapeBlockPropertiesPanel } from "./ShapeBlockPropertiesPanel";
import { ImageBlockPropertiesPanel } from "./ImageBlockPropertiesPanel";
import { VideoBlockPropertiesPanel } from "./VideoBlockPropertiesPanel";
import { DPEBlockPropertiesPanel } from "./DPEBlockPropertiesPanel";
import { TextBlockPropertiesPanel } from "./TextBlockPropertiesPanel";
import { TextContentSection } from "./TextContentSection";

export function BlockBasePropertiesSection({
  block,
  globalFonts,
  showResolvedTextPreview,
  onShowResolvedTextPreviewChange,
}: {
  block: AnyBlock;
  globalFonts: BuilderFontEntry[];
  showResolvedTextPreview: boolean;
  onShowResolvedTextPreviewChange: (value: boolean) => void;
}) {
  const { template, updateBlock, setSchema } = useBuilderStore();
  const prevBindingRef = useRef<string>("");

  function updateSchemaField(fieldKey: string, changes: Partial<SchemaField>) {
    setSchema(template.schema.map((field) => (
      field.key === fieldKey ? { ...field, ...changes } : field
    )));
  }

  function syncTextSchema(oldContent: string, newContent: string) {
    const oldVars = extractTemplateVars(oldContent);
    const newVars = extractTemplateVars(newContent);
    let nextSchema = [...template.schema];

    for (const key of oldVars) {
      if (!newVars.includes(key)) {
        const usedElsewhere = template.blocks.some((b) => {
          if (b.id === block.id) return false;
          if (b.binding === key) return true;
          return (b as TextBlock).content?.includes(`{{${key}}}`) ?? false;
        });
        if (!usedElsewhere) nextSchema = nextSchema.filter((f) => f.key !== key);
      }
    }

    for (const key of newVars) {
      if (!nextSchema.some((f) => f.key === key)) {
        nextSchema.push({ key, label: key.replace(/_/g, " "), type: "text", required: false });
      }
    }

    setSchema(nextSchema);
  }

  return (
    <>
      <Section label="Calque">
        <label className="flex flex-col gap-0.5">
          <span className="text-gray-400 uppercase">Nom</span>
          <input
            type="text"
            value={block.name ?? ""}
            onChange={(e) => updateBlock(block.id, { name: e.target.value } as Partial<AnyBlock>)}
            placeholder={`${block.type}-${block.id.slice(-4)}`}
            className="border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
        </label>
        <label className="flex flex-col gap-0.5 mt-2">
          <span className="text-gray-400 uppercase">Groupe</span>
          <select
            value={block.groupId ?? ""}
            onChange={(e) => updateBlock(block.id, { groupId: e.target.value || undefined } as Partial<AnyBlock>)}
            className="border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          >
            <option value="">Aucun groupe</option>
            {template.groups.map((groupOption) => (
              <option key={groupOption.id} value={groupOption.id}>{groupOption.name}</option>
            ))}
          </select>
        </label>
      </Section>

      {/* Position & taille */}
      <Section label="Position / Taille">
        <div className="grid grid-cols-2 gap-2">
          {(["x", "y", "w", "h", "z"] as const).map((field) => (
            <label key={field} className="flex flex-col gap-0.5">
              <span className="text-gray-400 uppercase">{field}</span>
              <input
                type="number"
                value={(block as unknown as Record<string, number>)[field]}
                min={field === "w" || field === "h" ? 0 : undefined}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  if (field === "w" || field === "h") {
                    updateBlock(block.id, buildAnchoredSizeChange(block, field, value));
                    return;
                  }
                  updateBlock(block.id, { [field]: value } as Partial<AnyBlock>);
                }}
                className="border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </label>
          ))}
          {/* Rotation */}
          <label className="flex flex-col gap-0.5 col-span-2">
            <span className="text-gray-400 uppercase">Rotation (°)</span>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={-180}
                max={180}
                step={1}
                value={block.rotation ?? 0}
                onChange={(e) => updateBlock(block.id, { rotation: Number(e.target.value) || undefined } as Partial<AnyBlock>)}
                className="flex-1"
              />
              <input
                type="number"
                min={-180}
                max={180}
                value={block.rotation ?? 0}
                onChange={(e) => updateBlock(block.id, { rotation: Number(e.target.value) || undefined } as Partial<AnyBlock>)}
                className="w-16 border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </div>
          </label>
        </div>
      </Section>

      {/* Timing vidéo — visible si le template a un bloc vidéo OU une séquence */}
      {((template.blocks.some((b) => b.type === "video") || (template.videoSequence?.length ?? 0) > 0)) && block.type !== "video" ? (
        <Section label="Timing vidéo">
          {/* Global fallback (non-sequence or per-slot not set) */}
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-0.5">
              <span className="text-gray-400 uppercase text-[10px]">Apparaît à (s)</span>
              <input
                type="number"
                min={0}
                step={0.5}
                placeholder="0"
                value={block.appearAt ?? ""}
                onChange={(e) => {
                  const raw = e.target.value;
                  updateBlock(block.id, {
                    appearAt: raw === "" ? undefined : Math.max(0, Number(raw)),
                  } as Partial<AnyBlock>);
                }}
                className="border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400 text-sm"
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-gray-400 uppercase text-[10px]">Disparaît à (s)</span>
              <input
                type="number"
                min={0}
                step={0.5}
                placeholder="fin"
                value={block.hideAt ?? ""}
                onChange={(e) => {
                  const raw = e.target.value;
                  updateBlock(block.id, {
                    hideAt: raw === "" ? undefined : Math.max(0, Number(raw)),
                  } as Partial<AnyBlock>);
                }}
                className="border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400 text-sm"
              />
            </label>
          </div>
          <p className="text-[10px] text-gray-400 mt-1">
            Vide = valeur par défaut (0 s / fin de vidéo). Pas d&apos;effet sur les renders image.
          </p>

          {/* Per-slot overrides: renvoi vers la timeline */}
          {(template.videoSequence?.length ?? 0) > 0 && (
            <p className="text-[10px] text-indigo-500 mt-1">
              Pour ajuster par clip : sélectionnez ce bloc + un clip dans la timeline ci-dessous.
            </p>
          )}
        </Section>
      ) : null}

      <Section label="Aligner sur le canvas">
        <div className="flex flex-col gap-1.5">
          {/* Horizontal */}
          <div className="flex gap-1">
            {([
              { title: "Aligner à gauche",        label: "⇤",  fn: () => ({ x: 0 }) },
              { title: "Centrer horizontalement", label: "↔",  fn: () => ({ x: Math.round((template.canvas.width  - block.w) / 2) }) },
              { title: "Aligner à droite",        label: "⇥",  fn: () => ({ x: template.canvas.width  - block.w }) },
            ] as { title: string; label: string; fn: () => Partial<AnyBlock> }[]).map(({ title, label, fn }) => (
              <button key={title} type="button" title={title} onClick={() => updateBlock(block.id, fn())}
                className="flex-1 py-1.5 rounded border border-gray-200 text-sm text-gray-500 hover:border-indigo-400 hover:text-indigo-700 hover:bg-indigo-50 transition-colors">
                {label}
              </button>
            ))}
          </div>
          {/* Vertical */}
          <div className="flex gap-1">
            {([
              { title: "Aligner en haut",        label: "⇡",  fn: () => ({ y: 0 }) },
              { title: "Centrer verticalement",  label: "↕",  fn: () => ({ y: Math.round((template.canvas.height - block.h) / 2) }) },
              { title: "Aligner en bas",         label: "⇣",  fn: () => ({ y: template.canvas.height - block.h }) },
            ] as { title: string; label: string; fn: () => Partial<AnyBlock> }[]).map(({ title, label, fn }) => (
              <button key={title} type="button" title={title} onClick={() => updateBlock(block.id, fn())}
                className="flex-1 py-1.5 rounded border border-gray-200 text-sm text-gray-500 hover:border-indigo-400 hover:text-indigo-700 hover:bg-indigo-50 transition-colors">
                {label}
              </button>
            ))}
          </div>
        </div>
      </Section>

      {/* Content (text blocks) — template string with {{variable}} interpolation */}
      {block.type === "text" && (
        <TextContentSection
          block={block as TextBlock}
          schema={template.schema}
          showResolvedTextPreview={showResolvedTextPreview}
          onShowResolvedTextPreviewChange={onShowResolvedTextPreviewChange}
          onUpdateBlock={(id, changes) => updateBlock(id, changes)}
          onUpdateSchemaField={updateSchemaField}
          onSyncTextSchema={syncTextSchema}
          onSetSchema={setSchema}
        />
      )}

      {/* Binding — only for image / dpe / shape blocks */}
      {block.type !== "text" && (
        <Section label="Binding (variable)">
          <input
            type="text"
            value={block.binding ?? ""}
            onChange={(e) => updateBlock(block.id, { binding: e.target.value || undefined })}
            onFocus={() => { prevBindingRef.current = block.binding ?? ""; }}
            onBlur={(e) => {
              const newKey = e.target.value.trim();
              const oldKey = prevBindingRef.current.trim();

              // Nothing changed
              if (newKey === oldKey) return;

              let nextSchema = [...template.schema];

              // Remove the old key if no OTHER block still uses it
              if (oldKey) {
                const stillUsed = template.blocks.some(
                  (b) => b.id !== block.id && b.binding === oldKey
                );
                if (!stillUsed) {
                  nextSchema = nextSchema.filter((f) => f.key !== oldKey);
                }
              }

              // Add new key if non-empty and not already in schema
              if (newKey && !nextSchema.some((f) => f.key === newKey)) {
                const inferredType: SchemaField["type"] =
                  block.type === "image" ? "image" :
                  block.type === "video" ? "video" : "text";
                nextSchema.push({
                  key: newKey,
                  label: newKey.replace(/_/g, " "),
                  type: inferredType,
                  required: false,
                });
              }

              setSchema(nextSchema);
            }}
            placeholder="ex: price_eur"
            className="w-full border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          {/* Inline required toggle for this binding */}
          {block.binding && (() => {
            const sf = template.schema.find((f) => f.key === block.binding);
            if (!sf) return (
              <p className="text-[10px] text-indigo-600 mt-1">
                Sauvegardez le champ pour l&apos;ajouter au schéma.
              </p>
            );
            return (
              <label className="flex items-center gap-1.5 mt-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={sf.required}
                  onChange={(e) => {
                    const next = template.schema.map((f) =>
                      f.key === block.binding ? { ...f, required: e.target.checked } : f
                    );
                    setSchema(next);
                  }}
                  className="rounded"
                />
                <span className="text-gray-600 text-[11px]">Obligatoire dans le formulaire</span>
                <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full ${
                  sf.required ? "bg-red-50 text-red-400" : "bg-gray-100 text-gray-400"
                }`}>
                  {sf.required ? "*" : "optionnel"}
                </span>
              </label>
            );
          })()}
        </Section>
      )}

      {/* Text specific */}
      {block.type === "text" && (
        <TextBlockPropertiesPanel
          block={block as TextBlock}
          globalFonts={globalFonts}
          onUpdateBlock={(id, changes) => updateBlock(id, changes)}
        />
      )}

      {/* Shape specific */}
      {block.type === "shape" && (
        <ShapeBlockPropertiesPanel block={block as ShapeBlock} onChange={(c) => updateBlock(block.id, c)} />
      )}

      {/* Image specific */}
      {block.type === "image" && (
        <ImageBlockPropertiesPanel block={block as ImageBlock} onChange={(c) => updateBlock(block.id, c)} />
      )}

      {/* Vidéo specific */}
      {block.type === "video" && (
        <VideoBlockPropertiesPanel block={block as VideoBlock} onChange={(c) => updateBlock(block.id, c)} />
      )}

      {/* DPE specific */}
      {block.type === "dpe" && (
        <DPEBlockPropertiesPanel block={block as DPEBlock} onChange={(c) => updateBlock(block.id, c)} />
      )}

      <BlockConditionalRulesSection
        block={block}
        schema={template.schema}
        onChange={(c) => updateBlock(block.id, c as Partial<AnyBlock>)}
      />
    </>
  );
}
