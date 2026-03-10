"use client";

import { useState } from "react";
import { useBuilderStore } from "@/lib/store/builderStore";
import type { SchemaField, SchemaFieldType } from "@/types/template";

const FIELD_TYPES: { value: SchemaFieldType; label: string }[] = [
  { value: "text",    label: "Texte" },
  { value: "number",  label: "Nombre" },
  { value: "url",     label: "URL" },
  { value: "image",   label: "Image" },
  { value: "video",   label: "Vidéo" },
  { value: "select",  label: "Liste (select)" },
  { value: "boolean", label: "Oui / Non" },
];

const EMPTY_NEW: Omit<SchemaField, "key"> = {
  label: "",
  type: "text",
  required: false,
  placeholder: "",
  description: undefined,
  options: [],
};

export function SchemaPanel() {
  const { template, setSchema } = useBuilderStore();
  const schema = template.schema;

  // Inline add form state
  const [adding, setAdding] = useState(false);
  const [newField, setNewField] = useState<Omit<SchemaField, "key"> & { key: string }>({
    key: "", ...EMPTY_NEW,
  });
  const [newOptions, setNewOptions] = useState(""); // comma-separated
  const [keyError, setKeyError] = useState("");

  // Editing existing
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

  function updateField(idx: number, changes: Partial<SchemaField>) {
    const next = schema.map((f, i) => (i === idx ? { ...f, ...changes } : f));
    setSchema(next);
  }

  function removeField(idx: number) {
    setSchema(schema.filter((_, i) => i !== idx));
  }

  function moveField(idx: number, dir: -1 | 1) {
    const next = [...schema];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setSchema(next);
  }

  function addField() {
    if (!newField.key.trim()) { setKeyError("Clé requise"); return; }
    if (!/^[a-z_][a-z0-9_]*$/.test(newField.key)) {
      setKeyError("Clé : lettres minuscules, chiffres et _ uniquement");
      return;
    }
    if (schema.some((f) => f.key === newField.key)) {
      setKeyError("Cette clé existe déjà");
      return;
    }
    const options = newField.type === "select"
      ? newOptions.split("\n").map((s) => s.trim()).filter(Boolean)
      : undefined;
    setSchema([...schema, { ...newField, key: newField.key.trim(), options, description: newField.description || undefined }]);
    setNewField({ key: "", ...EMPTY_NEW });
    setNewOptions("");
    setKeyError("");
    setAdding(false);
  }

  return (
    <div className="w-full bg-white flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2.5 border-b border-gray-100 flex items-center justify-between">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
          Variables ({schema.length})
        </p>
        <button
          onClick={() => { setAdding(true); setKeyError(""); }}
          title="Ajouter une variable"
          className="text-xs text-indigo-700 hover:text-indigo-700 font-bold"
        >
          + Ajouter
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5">
        {schema.length === 0 && !adding && (
          <p className="text-[10px] text-gray-400 text-center mt-6 px-2">
            Aucune variable. Cliquez sur + Ajouter pour définir les champs du formulaire de génération.
          </p>
        )}

        {schema.map((field, idx) => (
          <div key={field.key} className="bg-gray-50 rounded-lg border border-gray-100">
            {editingIdx === idx ? (
              /* ── Edit mode ── */
              <div className="p-2 space-y-1.5 text-xs">
                <div className="flex flex-col gap-0.5">
                  <span className="text-gray-400">Clé <span className="text-gray-300">(variable dans le builder)</span></span>
                  <p className="font-mono bg-gray-100 border border-gray-200 rounded px-2 py-1 text-gray-600 select-all">{`{{${field.key}}}`}</p>
                </div>
                <label className="flex flex-col gap-0.5">
                  <span className="text-gray-400">Nom affiché <span className="text-gray-300">(dans le formulaire)</span></span>
                  <input
                    type="text"
                    value={field.label}
                    onChange={(e) => updateField(idx, { label: e.target.value })}
                    className="border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-gray-400">Description <span className="text-gray-300">(aide sous le champ)</span></span>
                  <input
                    type="text"
                    value={field.description ?? ""}
                    onChange={(e) => updateField(idx, { description: e.target.value || undefined })}
                    placeholder="ex : Entrer uniquement le nombre, sans unité"
                    className="border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-gray-400">Placeholder <span className="text-gray-300">(texte indicatif)</span></span>
                  <input
                    type="text"
                    value={field.placeholder ?? ""}
                    onChange={(e) => updateField(idx, { placeholder: e.target.value || undefined })}
                    placeholder="ex : 980000"
                    className="border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-gray-400">Type</span>
                  <select
                    value={field.type}
                    onChange={(e) => updateField(idx, { type: e.target.value as SchemaFieldType })}
                    className="border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  >
                    {FIELD_TYPES.map(({ value, label }) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                {field.type === "select" && (
                  <label className="flex flex-col gap-0.5">
                    <span className="text-gray-400">Options <span className="text-gray-300">(une par ligne)</span></span>
                    <textarea
                      rows={4}
                      value={field.options?.join("\n") ?? ""}
                      onChange={(e) =>
                        updateField(idx, {
                          options: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean),
                        })
                      }
                      placeholder={"vendeur\nacquéreur"}
                      className="border border-gray-200 rounded px-2 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400 font-mono text-[11px]"
                    />
                    <p className="text-[9px] text-gray-400">Une option par ligne — les virgules sont autorisées dans les valeurs.</p>
                  </label>
                )}
                {/* showIf — conditional visibility */}
                <div className="space-y-1 pt-0.5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!field.showIf}
                      onChange={(e) =>
                        updateField(idx, { showIf: e.target.checked ? { field: "", equals: "" } : undefined })
                      }
                    />
                    <span className="text-gray-500">Afficher seulement si…</span>
                  </label>
                  {field.showIf && (
                    <div className="pl-5 space-y-1">
                      <label className="flex flex-col gap-0.5">
                        <span className="text-gray-400 text-[10px]">Champ</span>
                        <select
                          value={field.showIf.field}
                          onChange={(e) => updateField(idx, { showIf: { ...field.showIf!, field: e.target.value } })}
                          className="w-full border border-gray-200 rounded px-1.5 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-indigo-400"
                        >
                          <option value="">— choisir —</option>
                          {schema.filter((f) => f.key !== field.key && f.type === "select").map((f) => (
                            <option key={f.key} value={f.key}>{f.label || f.key}</option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-0.5">
                        <span className="text-gray-400 text-[10px]">Valeur attendue</span>
                        <select
                          value={field.showIf.equals}
                          onChange={(e) => updateField(idx, { showIf: { ...field.showIf!, equals: e.target.value } })}
                          className="w-full border border-gray-200 rounded px-1.5 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-indigo-400"
                        >
                          <option value="">— choisir —</option>
                          {(schema.find((f) => f.key === field.showIf!.field)?.options ?? []).map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      </label>
                      {field.showIf.field && field.showIf.equals && (
                        <p className="text-[9px] text-indigo-700">Visible si <strong>{field.showIf.field}</strong> = <strong>{field.showIf.equals}</strong></p>
                      )}
                    </div>
                  )}
                </div>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={(e) => updateField(idx, { required: e.target.checked })}
                    className="rounded"
                  />
                  <span className="text-gray-600">Obligatoire</span>
                </label>
                <button
                  onClick={() => setEditingIdx(null)}
                  className="w-full text-center text-xs py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors"
                >
                  OK
                </button>
              </div>
            ) : (
              /* ── Display mode ── */
              <div className="px-2.5 py-2 flex items-center gap-1.5">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-700 truncate">{field.label || field.key}</p>
                  <p className="text-[10px] text-gray-400 font-mono">{`{{${field.key}}}`} · {FIELD_TYPES.find(t => t.value === field.type)?.label ?? field.type}</p>
                  {field.type === "select" && field.options && field.options.length > 0 && (
                    <div className="flex flex-wrap gap-0.5 mt-0.5">
                      {field.options.slice(0, 4).map((opt) => (
                        <span key={opt} className="bg-indigo-50 border border-indigo-100 text-indigo-700 text-[9px] px-1 rounded">{opt}</span>
                      ))}
                      {field.options.length > 4 && (
                        <span className="text-[9px] text-gray-400">+{field.options.length - 4}</span>
                      )}
                    </div>
                  )}
                  {field.showIf && (
                    <p className="text-[9px] text-blue-400 mt-0.5">si {field.showIf.field} = {field.showIf.equals}</p>
                  )}
                  {field.description && field.type !== "select" && (
                    <p className="text-[10px] text-gray-400 italic truncate">{field.description}</p>
                  )}
                </div>
                {/* Required toggle inline */}
                <button
                  onClick={() => updateField(idx, { required: !field.required })}
                  title={field.required ? "Rendre optionnel" : "Rendre obligatoire"}
                  className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full border transition-colors ${
                    field.required
                      ? "bg-red-50 border-red-200 text-red-500"
                      : "bg-gray-50 border-gray-200 text-gray-400 hover:border-gray-300"
                  }`}
                >
                  {field.required ? "*" : "opt"}
                </button>
                <div className="flex flex-col gap-0.5">
                  <button onClick={() => moveField(idx, -1)} disabled={idx === 0}
                    className="text-gray-300 hover:text-gray-600 disabled:opacity-20 leading-none text-xs">▲</button>
                  <button onClick={() => moveField(idx, 1)} disabled={idx === schema.length - 1}
                    className="text-gray-300 hover:text-gray-600 disabled:opacity-20 leading-none text-xs">▼</button>
                </div>
                <button onClick={() => setEditingIdx(idx)}
                  className="text-gray-400 hover:text-gray-700 text-xs">✎</button>
                <button onClick={() => removeField(idx)}
                  className="text-gray-300 hover:text-red-400 text-xs">✕</button>
              </div>
            )}
          </div>
        ))}

        {/* ── Add new field form ── */}
        {adding && (
          <div className="bg-indigo-50 rounded-lg border border-indigo-200 p-2 space-y-1.5 text-xs mt-2">
            <p className="text-[10px] font-semibold text-indigo-700 uppercase tracking-wide">Nouvelle variable</p>
            <label className="flex flex-col gap-0.5">
              <span className="text-gray-500">Clé <span className="text-gray-300">(ex: price_eur)</span></span>
              <input
                type="text"
                value={newField.key}
                onChange={(e) => { setNewField({ ...newField, key: e.target.value }); setKeyError(""); }}
                placeholder="ma_variable"
                className="border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
              {keyError && <p className="text-red-500 text-[10px]">{keyError}</p>}
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-gray-500">Nom affiché <span className="text-gray-300">(dans le formulaire)</span></span>
              <input
                type="text"
                value={newField.label}
                onChange={(e) => setNewField({ ...newField, label: e.target.value })}
                placeholder="Nbr de salle de bain"
                className="border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-gray-500">Description <span className="text-gray-300">(aide sous le champ)</span></span>
              <input
                type="text"
                value={newField.description ?? ""}
                onChange={(e) => setNewField({ ...newField, description: e.target.value || undefined })}
                placeholder="ex : Entrer uniquement le nombre, sans unité"
                className="border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-gray-500">Placeholder <span className="text-gray-300">(texte indicatif)</span></span>
              <input
                type="text"
                value={newField.placeholder ?? ""}
                onChange={(e) => setNewField({ ...newField, placeholder: e.target.value || undefined })}
                placeholder="ex : 980000"
                className="border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-gray-500">Type</span>
              <select
                value={newField.type}
                onChange={(e) => setNewField({ ...newField, type: e.target.value as SchemaFieldType })}
                className="border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              >
                {FIELD_TYPES.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            {newField.type === "select" && (
              <label className="flex flex-col gap-0.5">
                <span className="text-gray-500">Options <span className="text-gray-300">(une par ligne)</span></span>
                <textarea
                  rows={4}
                  value={newOptions}
                  onChange={(e) => setNewOptions(e.target.value)}
                  placeholder={"vendeur\nacquéreur"}
                  className="border border-gray-200 rounded px-2 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400 font-mono text-[11px]"
                />
                <p className="text-[9px] text-gray-400">Une option par ligne — les virgules sont autorisées dans les valeurs.</p>
              </label>
            )}
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={newField.required}
                onChange={(e) => setNewField({ ...newField, required: e.target.checked })}
                className="rounded"
              />
              <span className="text-gray-600">Obligatoire</span>
            </label>
            <div className="flex gap-1.5 pt-1">
              <button
                onClick={addField}
                className="flex-1 text-center py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors"
              >
                Ajouter
              </button>
              <button
                onClick={() => { setAdding(false); setKeyError(""); }}
                className="flex-1 text-center py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors"
              >
                Annuler
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
