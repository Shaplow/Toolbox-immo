"use client";

import { useState } from "react";
import type { SchemaField } from "@/types/template";

/**
 * Renders metadata about a schema field (type badge, required badge, options,
 * and the inline select editor for "condition" kind).
 *
 * Owns the inlineSelectEditorKey / inlineSelectDrafts local state.
 * When the user saves inline select options, calls onSaveOptions so the parent
 * can propagate the change to the schema (via updateSchemaField or setSchema).
 */
export function TextFieldMeta({
  field,
  kind,
  rawKey,
  onSaveOptions,
}: {
  field: SchemaField | undefined;
  kind: "variable" | "condition";
  rawKey: string;
  onSaveOptions?: (fieldKey: string, options: string[]) => void;
}) {
  const [inlineSelectEditorKey, setInlineSelectEditorKey] = useState<string | null>(null);
  const [inlineSelectDrafts, setInlineSelectDrafts] = useState<Record<string, string>>({});

  function openInlineSelectEditor(f: SchemaField) {
    if (f.type !== "select") return;
    setInlineSelectEditorKey(f.key);
    setInlineSelectDrafts((current) => ({
      ...current,
      [f.key]: current[f.key] ?? f.options?.join("\n") ?? "",
    }));
  }

  function closeInlineSelectEditor() {
    setInlineSelectEditorKey(null);
  }

  function handleSaveOptions(fieldKey: string) {
    const draft = inlineSelectDrafts[fieldKey] ?? "";
    const options = draft.split("\n").map((v) => v.trim()).filter(Boolean);
    onSaveOptions?.(fieldKey, options);
    closeInlineSelectEditor();
  }

  if (kind === "condition" && !rawKey.trim()) {
    return (
      <div className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11px] text-gray-500">
        Choisissez une variable existante pour definir la condition.
      </div>
    );
  }

  if (!field) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700">
        <span className="font-medium">Champ non defini</span>
        {rawKey ? `: ${rawKey}` : ""}. Ajoutez-le dans le schema ou corrigez la cle.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11px] text-gray-600 space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-gray-700">{field.key}</span>
        <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-500">{field.type}</span>
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${field.required ? "bg-red-50 text-red-500" : "bg-gray-100 text-gray-500"}`}>
          {field.required ? "requis" : "optionnel"}
        </span>
        {kind === "condition" && field.showIf && (
          <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-600">
            visible si {field.showIf.field} = {field.showIf.equals}
          </span>
        )}
      </div>
      <div className="text-gray-500">
        {field.label || field.key}
        {field.description ? ` · ${field.description}` : ""}
      </div>
      {field.type === "select" && (
        <div className="space-y-1">
          <div className="flex flex-wrap gap-1">
            {(field.options ?? []).length > 0 ? (field.options ?? []).map((option) => (
              <span key={option} className="rounded-full border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-600">
                {option}
              </span>
            )) : (
              <span className="text-[10px] text-gray-400">Aucune option definie.</span>
            )}
          </div>
          {kind === "condition" && (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => inlineSelectEditorKey === field.key ? closeInlineSelectEditor() : openInlineSelectEditor(field)}
                  className="text-[10px] font-medium text-indigo-600 hover:text-indigo-700"
                >
                  {inlineSelectEditorKey === field.key ? "Fermer l'edition" : "Modifier les options ici"}
                </button>
              </div>
              {inlineSelectEditorKey === field.key && (
                <div className="rounded-md border border-indigo-100 bg-indigo-50 p-2 space-y-2">
                  <textarea
                    rows={4}
                    value={inlineSelectDrafts[field.key] ?? field.options?.join("\n") ?? ""}
                    onChange={(e) => setInlineSelectDrafts((current) => ({
                      ...current,
                      [field.key]: e.target.value,
                    }))}
                    onKeyDown={(e) => e.stopPropagation()}
                    placeholder="Une option par ligne"
                    className="w-full resize-none rounded border border-indigo-200 bg-white px-2 py-1.5 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={closeInlineSelectEditor}
                      className="px-2 py-1 text-[10px] border border-gray-200 rounded hover:bg-white"
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveOptions(field.key)}
                      className="px-2 py-1 text-[10px] rounded bg-indigo-600 text-white hover:bg-indigo-700"
                    >
                      Enregistrer
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
