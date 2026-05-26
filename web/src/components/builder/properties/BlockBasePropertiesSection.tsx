"use client";

import { useRef } from "react";
import { extractTemplateVars } from "@/lib/textTemplate";
import { useBuilderStore } from "@/lib/store/builderStore";
import type {
  AnyBlock, TextBlock, ImageBlock, VideoBlock, DPEBlock,
  ShapeBlock, SchemaField,
} from "@/types/template";
import { type BuilderFontEntry } from "@/lib/builderFonts";
import { Slider } from "@/components/ui/Slider";
import { Section } from "./Section";
import { buildAnchoredSizeChange } from "./utils";
import { BlockConditionalRulesSection } from "./BlockConditionalRulesSection";
import { ShapeBlockPropertiesPanel } from "./ShapeBlockPropertiesPanel";
import { ImageBlockPropertiesPanel } from "./ImageBlockPropertiesPanel";
import { VideoBlockPropertiesPanel } from "./VideoBlockPropertiesPanel";
import { DPEBlockPropertiesPanel } from "./DPEBlockPropertiesPanel";
import { TextBlockPropertiesPanel } from "./TextBlockPropertiesPanel";
import { TextContentSection } from "./TextContentSection";

/** Shared align button row used for both canvas align sections */
function AlignButtonRow({
  actions,
}: {
  actions: { title: string; label: string; fn: () => void }[];
}) {
  return (
    <div className="flex gap-1">
      {actions.map(({ title, label, fn }) => (
        <button
          key={title}
          type="button"
          title={title}
          onClick={fn}
          className="flex-1 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-500 hover:border-indigo-400 hover:text-indigo-700 hover:bg-indigo-50 transition-colors"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

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
      {/* ── Calque ── */}
      <Section label="Calque">
        <div className="space-y-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600">Nom</span>
            <input
              type="text"
              value={block.name ?? ""}
              onChange={(e) => updateBlock(block.id, { name: e.target.value } as Partial<AnyBlock>)}
              placeholder={`${block.type}-${block.id.slice(-4)}`}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600">Groupe</span>
            <select
              value={block.groupId ?? ""}
              onChange={(e) => updateBlock(block.id, { groupId: e.target.value || undefined } as Partial<AnyBlock>)}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
            >
              <option value="">Aucun groupe</option>
              {template.groups.map((groupOption) => (
                <option key={groupOption.id} value={groupOption.id}>{groupOption.name}</option>
              ))}
            </select>
          </label>
        </div>
      </Section>

      {/* ── Position / Taille ── */}
      <Section label="Position / Taille">
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {(["x", "y", "w", "h", "z"] as const).map((field) => (
              <label key={field} className="flex flex-col gap-1">
                <span className="text-xs font-medium text-gray-600 uppercase">{field}</span>
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
                  className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
                />
              </label>
            ))}
          </div>

          {/* Rotation slider + number input */}
          <Slider
            label="Rotation"
            value={block.rotation ?? 0}
            onChange={(v) => updateBlock(block.id, { rotation: v || undefined } as Partial<AnyBlock>)}
            min={-180}
            max={180}
            unit="°"
          />
        </div>
      </Section>

      {/* ── Timing vidéo ── */}
      {((template.blocks.some((b) => b.type === "video") || (template.videoSequence?.length ?? 0) > 0)) && block.type !== "video" ? (
        <Section label="Timing vidéo">
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-gray-600">Apparaît à (s)</span>
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
                  className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-gray-600">Disparaît à (s)</span>
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
                  className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
                />
              </label>
            </div>
            <p className="text-[10px] text-gray-400">
              Vide = valeur par défaut (0 s / fin de vidéo). Pas d&apos;effet sur les renders image.
            </p>
            {(template.videoSequence?.length ?? 0) > 0 && (
              <p className="text-[10px] text-indigo-500">
                Pour ajuster par clip : sélectionnez ce bloc + un clip dans la timeline ci-dessous.
              </p>
            )}
          </div>
        </Section>
      ) : null}

      {/* ── Aligner sur le canvas ── */}
      <Section label="Aligner sur le canvas">
        <div className="flex flex-col gap-1.5">
          <AlignButtonRow actions={[
            { title: "Aligner à gauche",        label: "⇤",  fn: () => updateBlock(block.id, { x: 0 }) },
            { title: "Centrer horizontalement", label: "↔",  fn: () => updateBlock(block.id, { x: Math.round((template.canvas.width  - block.w) / 2) }) },
            { title: "Aligner à droite",        label: "⇥",  fn: () => updateBlock(block.id, { x: template.canvas.width  - block.w }) },
          ]} />
          <AlignButtonRow actions={[
            { title: "Aligner en haut",        label: "⇡",  fn: () => updateBlock(block.id, { y: 0 }) },
            { title: "Centrer verticalement",  label: "↕",  fn: () => updateBlock(block.id, { y: Math.round((template.canvas.height - block.h) / 2) }) },
            { title: "Aligner en bas",         label: "⇣",  fn: () => updateBlock(block.id, { y: template.canvas.height - block.h }) },
          ]} />
        </div>
      </Section>

      {/* ── Contenu (text blocks) ── */}
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

      {/* ── Binding (non-text blocks) ── */}
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

              if (newKey === oldKey) return;

              let nextSchema = [...template.schema];

              if (oldKey) {
                const stillUsed = template.blocks.some(
                  (b) => b.id !== block.id && b.binding === oldKey
                );
                if (!stillUsed) {
                  nextSchema = nextSchema.filter((f) => f.key !== oldKey);
                }
              }

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
            className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
          />
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
                <span className={[
                  "ml-auto text-[10px] px-1.5 py-0.5 rounded-full",
                  sf.required ? "bg-red-50 text-red-400" : "bg-gray-100 text-gray-400",
                ].join(" ")}>
                  {sf.required ? "*" : "optionnel"}
                </span>
              </label>
            );
          })()}
        </Section>
      )}

      {/* ── Block-type specific panels ── */}
      {block.type === "text" && (
        <TextBlockPropertiesPanel
          block={block as TextBlock}
          globalFonts={globalFonts}
          onUpdateBlock={(id, changes) => updateBlock(id, changes)}
        />
      )}
      {block.type === "shape" && (
        <ShapeBlockPropertiesPanel block={block as ShapeBlock} onChange={(c) => updateBlock(block.id, c)} />
      )}
      {block.type === "image" && (
        <ImageBlockPropertiesPanel block={block as ImageBlock} onChange={(c) => updateBlock(block.id, c)} />
      )}
      {block.type === "video" && (
        <VideoBlockPropertiesPanel block={block as VideoBlock} onChange={(c) => updateBlock(block.id, c)} />
      )}
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
