"use client";

import { useRef } from "react";
import {
  compileTextTemplate,
  extractTemplateVars,
  parseTextTemplate,
  resolveTextTemplate,
  type TextTemplateSegment,
} from "@/lib/textTemplate";
import { buildSchemaPreviewData } from "@/lib/schemaFields";
import type { AnyBlock, SchemaField, TextBlock } from "@/types/template";
import type { ListingData } from "@/types/listing";
import { Section } from "./Section";
import { TextFieldMeta } from "./TextFieldMeta";

export function TextContentSection({
  block,
  schema,
  showResolvedTextPreview,
  onShowResolvedTextPreviewChange,
  onUpdateBlock,
  onUpdateSchemaField,
  onSyncTextSchema,
  onSetSchema,
}: {
  block: TextBlock;
  schema: SchemaField[];
  showResolvedTextPreview: boolean;
  onShowResolvedTextPreviewChange: (value: boolean) => void;
  onUpdateBlock: (id: string, changes: Partial<AnyBlock>) => void;
  onUpdateSchemaField: (fieldKey: string, changes: Partial<SchemaField>) => void;
  onSyncTextSchema: (oldContent: string, newContent: string) => void;
  onSetSchema: (schema: SchemaField[]) => void;
}) {
  const prevContentRef = useRef<string>("");

  const currentContent = block.content
    ?? (block.contentSegments ? compileTextTemplate(block.contentSegments) : undefined)
    ?? (block.binding ? `{{${block.binding}}}` : block.staticText ?? "");
  const currentSegments = block.contentSegments ?? parseTextTemplate(currentContent);
  const schemaKeyListId = `schema-keys-${block.id}`;
  const schemaFieldOptions = [...schema].sort((a, b) => a.label.localeCompare(b.label, "fr", { sensitivity: "base" }));
  const previewData = buildSchemaPreviewData(schema);
  const previewText = resolveTextTemplate(currentContent, previewData as ListingData, schema);

  function applySegments(nextSegments: TextTemplateSegment[]) {
    const nextContent = compileTextTemplate(nextSegments);
    onUpdateBlock(block.id, { content: nextContent, contentSegments: nextSegments } as Partial<AnyBlock>);
    onSyncTextSchema(currentContent, nextContent);
  }

  function updateSegment(index: number, nextSegment: TextTemplateSegment) {
    const nextSegments = [...currentSegments];
    nextSegments[index] = nextSegment;
    applySegments(nextSegments);
  }

  function removeSegment(index: number) {
    applySegments(currentSegments.filter((_, currentIndex) => currentIndex !== index));
  }

  function moveSegment(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= currentSegments.length) return;
    const nextSegments = [...currentSegments];
    const [segment] = nextSegments.splice(index, 1);
    nextSegments.splice(nextIndex, 0, segment);
    applySegments(nextSegments);
  }

  function addSegment(type: TextTemplateSegment["type"]) {
    const baseSegment: TextTemplateSegment =
      type === "text"
        ? { type: "text", value: "" }
        : type === "variable"
          ? { type: "variable", key: "nouvelle_variable" }
          : { type: "if", field: "", equals: "", thenContent: "", elseContent: "" };
    applySegments([...currentSegments, baseSegment]);
  }

  const segmentTypeLabel: Record<TextTemplateSegment["type"], string> = {
    text: "Texte",
    variable: "Variable",
    if: "Condition",
  };
  const segmentTypeBadge: Record<TextTemplateSegment["type"], string> = {
    text: "bg-gray-100 text-gray-500",
    variable: "bg-indigo-50 text-indigo-600",
    if: "bg-amber-50 text-amber-600",
  };

  return (
    <Section label="Contenu">
      <div className="space-y-2">
        {currentSegments.length === 0 && (
          <div className="border border-dashed border-gray-200 rounded-lg px-3 py-3 text-[11px] text-gray-400 text-center">
            Aucun segment. Ajoutez du texte, une variable ou une condition.
          </div>
        )}
        {currentSegments.map((segment, index) => (
          <div key={`${segment.type}-${index}`} className="border border-gray-200 rounded-lg p-2.5 space-y-2 bg-white">
            {/* Segment header */}
            <div className="flex items-center gap-1.5">
              <span className={[
                "text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded-md",
                segmentTypeBadge[segment.type],
              ].join(" ")}>
                {segmentTypeLabel[segment.type]}
              </span>
              <div className="flex items-center gap-1 ml-auto">
                <button
                  type="button"
                  onClick={() => moveSegment(index, -1)}
                  disabled={index === 0}
                  className="px-1.5 py-0.5 text-[10px] border border-gray-200 rounded text-gray-500 hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-30 transition-colors"
                >↑</button>
                <button
                  type="button"
                  onClick={() => moveSegment(index, 1)}
                  disabled={index === currentSegments.length - 1}
                  className="px-1.5 py-0.5 text-[10px] border border-gray-200 rounded text-gray-500 hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-30 transition-colors"
                >↓</button>
                <button
                  type="button"
                  onClick={() => removeSegment(index)}
                  className="px-1.5 py-0.5 text-[10px] border border-red-200 text-red-400 rounded hover:bg-red-50 hover:text-red-600 transition-colors"
                >Suppr.</button>
              </div>
            </div>

            {segment.type === "text" && (
              <textarea
                rows={2}
                value={segment.value}
                onChange={(e) => updateSegment(index, { ...segment, value: e.target.value })}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder="Texte libre"
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
              />
            )}

            {segment.type === "variable" && (
              <div className="space-y-2">
                <input
                  type="text"
                  list={schemaKeyListId}
                  value={segment.key}
                  onChange={(e) => updateSegment(index, { ...segment, key: e.target.value.replace(/\s+/g, "_") })}
                  placeholder="nom_variable"
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
                />
                <TextFieldMeta
                  field={schema.find((field) => field.key === segment.key)}
                  kind="variable"
                  rawKey={segment.key}
                  onSaveOptions={(fieldKey, options) => onUpdateSchemaField(fieldKey, { options })}
                />
              </div>
            )}

            {segment.type === "if" && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={segment.field}
                    onChange={(e) => updateSegment(index, { ...segment, field: e.target.value })}
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
                  >
                    <option value="">Choisir une variable</option>
                    {schemaFieldOptions.map((field) => (
                      <option key={field.key} value={field.key}>
                        {field.label} ({field.key})
                      </option>
                    ))}
                    {segment.field && !schemaFieldOptions.some((field) => field.key === segment.field) ? (
                      <option value={segment.field}>{segment.field}</option>
                    ) : null}
                  </select>
                  <input
                    type="text"
                    value={segment.equals}
                    onChange={(e) => updateSegment(index, { ...segment, equals: e.target.value })}
                    placeholder="valeur attendue"
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
                  />
                </div>
                {(() => {
                  const conditionField = schema.find((field) => field.key === segment.field);
                  return (
                    <div className="space-y-2">
                      <TextFieldMeta
                        field={conditionField}
                        kind="condition"
                        rawKey={segment.field}
                        onSaveOptions={(fieldKey, options) => onUpdateSchemaField(fieldKey, { options })}
                      />
                      {conditionField?.type === "select" && (conditionField.options?.length ?? 0) > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {(conditionField.options ?? []).map((option) => {
                            const isActive = segment.equals === option;
                            return (
                              <button
                                key={option}
                                type="button"
                                onClick={() => updateSegment(index, { ...segment, equals: option })}
                                className={[
                                  "rounded-full px-2 py-0.5 text-[10px] border transition-colors",
                                  isActive
                                    ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                                    : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50",
                                ].join(" ")}
                              >
                                {option}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-gray-600">Si vrai</span>
                  <textarea
                    rows={2}
                    value={segment.thenContent}
                    onChange={(e) => updateSegment(index, { ...segment, thenContent: e.target.value })}
                    onKeyDown={(e) => e.stopPropagation()}
                    placeholder="Contenu affiché si la condition est vraie"
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-gray-600">Sinon</span>
                  <textarea
                    rows={2}
                    value={segment.elseContent ?? ""}
                    onChange={(e) => updateSegment(index, { ...segment, elseContent: e.target.value })}
                    onKeyDown={(e) => e.stopPropagation()}
                    placeholder="Contenu affiché sinon (optionnel)"
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
                  />
                </label>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add segment buttons */}
      <div className="flex flex-wrap gap-1.5 mt-2">
        {(["text", "variable", "if"] as const).map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => addSegment(type)}
            className="px-2 py-1 text-[11px] border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 hover:border-indigo-300 hover:text-indigo-600 transition-colors"
          >
            + {type === "text" ? "Texte" : type === "variable" ? "Variable" : "Condition"}
          </button>
        ))}
      </div>

      <datalist id={schemaKeyListId}>
        {schema.map((field) => (
          <option key={field.key} value={field.key}>
            {field.label}
          </option>
        ))}
      </datalist>

      <details className="mt-3">
        <summary className="cursor-pointer text-[11px] text-gray-500 select-none">Mode avancé</summary>
        <textarea
          rows={4}
          value={currentContent}
          onChange={(e) => {
            onUpdateBlock(block.id, { content: e.target.value, contentSegments: parseTextTemplate(e.target.value) } as Partial<AnyBlock>);
            onSyncTextSchema(currentContent, e.target.value);
          }}
          onFocus={() => { prevContentRef.current = currentContent; }}
          onBlur={(e) => onSyncTextSchema(prevContentRef.current, e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder={`Texte libre avec variables :\n{{prix}} € · Surface : {{surface}} m²\n\nConditionnel :\n{{#if is_copro == oui}} - Nbre lots : {{nbre_lots}}{{/if}}`}
          className="mt-2 w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
        />
      </details>

      <p className="text-[10px] text-gray-400 mt-1 leading-relaxed">
        <code className="bg-gray-100 px-0.5 rounded">{`{{variable}}`}</code> pour insérer une valeur.{" "}
        <code className="bg-gray-100 px-0.5 rounded">{`{{#if champ == val}}...{{else}}...{{/if}}`}</code> pour un segment conditionnel.{" "}
        Les espaces, tirets et retours à la ligne sont conservés tels qu&apos;ils sont écrits.
      </p>

      {/* Aperçu */}
      <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Aperçu</p>
          <input
            type="checkbox"
            checked={showResolvedTextPreview}
            onChange={(e) => onShowResolvedTextPreviewChange(e.target.checked)}
            title="Afficher le texte d'aperçu dans le builder"
            className="rounded"
          />
        </div>
        <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-gray-700 font-sans">
          {previewText || "Aucun contenu affiché avec les valeurs actuelles."}
        </pre>
      </div>

      {extractTemplateVars(currentContent).map((key) => {
        const sf = schema.find((f) => f.key === key);
        if (!sf) return null;
        return (
          <label key={key} className="flex items-center gap-1.5 mt-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={sf.required}
              onChange={(e) => onSetSchema(schema.map((f) =>
                f.key === key ? { ...f, required: e.target.checked } : f
              ))}
              className="rounded"
            />
            <code className="text-[11px] text-indigo-700 bg-indigo-50 px-1 rounded">{`{{${key}}}`}</code>
            <span className={[
              "ml-auto text-[10px] px-1.5 py-0.5 rounded-full",
              sf.required ? "bg-red-50 text-red-400" : "bg-gray-100 text-gray-400",
            ].join(" ")}>
              {sf.required ? "*" : "opt"}
            </span>
          </label>
        );
      })}
    </Section>
  );
}
