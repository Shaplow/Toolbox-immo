"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, GripVertical } from "lucide-react";

/**
 * Mini-éditeur contrôlé pour la clé d'un champ flex.
 *
 * Avant : <input defaultValue={key}> uncontrolled — si l'utilisateur
 * renommait rapidement 2 fields, le onBlur du premier pouvait être
 * déclenché APRÈS le rerender qui changeait la liste des fields, et
 * lire l'event.target.value qui pointait vers une valeur stale.
 *
 * Solution : state local par-input via composant dédié. Resync avec
 * originalKey si la prop change (ex : renommé ailleurs / liste réordonnée).
 */
function KeyEditor({ originalKey, onCommit }: { originalKey: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(originalKey);
  // Resync si la prop change (e.g. autre source de modification).
  useEffect(() => {
    setDraft(originalKey);
  }, [originalKey]);
  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== originalKey) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === "Escape") {
          setDraft(originalKey);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="w-32 shrink-0 text-xs border border-gray-200 rounded px-2 py-1 text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-300 bg-gray-50"
    />
  );
}

interface FlexFieldsEditorProps {
  schema: string[];
  values: Record<string, string>;
  onChange: (schema: string[], values: Record<string, string>) => void;
  readOnly?: boolean;
}

export function FlexFieldsEditor({ schema, values, onChange, readOnly = false }: FlexFieldsEditorProps) {
  const [newKey, setNewKey] = useState("");

  function updateValue(key: string, value: string) {
    onChange(schema, { ...values, [key]: value });
  }

  function addField() {
    const trimmed = newKey.trim();
    if (!trimmed || schema.includes(trimmed)) return;
    const newSchema = [...schema, trimmed];
    onChange(newSchema, { ...values, [trimmed]: "" });
    setNewKey("");
  }

  function removeField(key: string) {
    const newSchema = schema.filter((k) => k !== key);
    const newValues = { ...values };
    delete newValues[key];
    onChange(newSchema, newValues);
  }

  function renameField(oldKey: string, newKeyValue: string) {
    const trimmed = newKeyValue.trim();
    if (!trimmed || (trimmed !== oldKey && schema.includes(trimmed))) return;
    const newSchema = schema.map((k) => (k === oldKey ? trimmed : k));
    const newValues: Record<string, string> = {};
    for (const k of Object.keys(values)) {
      newValues[k === oldKey ? trimmed : k] = values[k];
    }
    onChange(newSchema, newValues);
  }

  return (
    <div className="space-y-2">
      {schema.length === 0 && (
        <p className="text-xs text-gray-400 italic">Aucun champ. Ajoutez-en un ci-dessous.</p>
      )}

      {schema.map((key) => (
        <div key={key} className="flex items-center gap-2">
          {!readOnly && (
            <span className="text-gray-300 shrink-0">
              <GripVertical size={14} />
            </span>
          )}
          {/* Key label — editable if not readOnly. Controlled via KeyEditor
              pour éviter les races onBlur stale entre 2 renames rapides. */}
          {readOnly ? (
            <span className="w-32 shrink-0 text-xs font-medium text-gray-600 truncate">{key}</span>
          ) : (
            <KeyEditor originalKey={key} onCommit={(next) => renameField(key, next)} />
          )}

          {/* Value */}
          <input
            type="text"
            value={values[key] ?? ""}
            onChange={(e) => updateValue(key, e.target.value)}
            readOnly={readOnly}
            placeholder={`Valeur pour « ${key} »`}
            className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 text-gray-800 focus:outline-none focus:ring-1 focus:ring-indigo-300 disabled:bg-gray-50"
          />

          {!readOnly && (
            <button
              type="button"
              onClick={() => removeField(key)}
              className="shrink-0 p-1 text-gray-400 hover:text-red-500 rounded"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      ))}

      {/* Add field row */}
      {!readOnly && (
        <div className="flex items-center gap-2 pt-1">
          <input
            type="text"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addField(); } }}
            placeholder="Nom du champ…"
            className="flex-1 text-xs border border-dashed border-gray-300 rounded px-2 py-1 text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-300"
          />
          <button
            type="button"
            onClick={addField}
            disabled={!newKey.trim()}
            className="shrink-0 px-2.5 py-1 text-xs text-indigo-600 border border-indigo-200 rounded hover:bg-indigo-50 disabled:opacity-40 flex items-center gap-1"
          >
            <Plus size={12} /> Ajouter
          </button>
        </div>
      )}
    </div>
  );
}
