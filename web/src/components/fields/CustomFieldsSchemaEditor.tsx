"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Checkbox } from "@/components/ui/Checkbox";
import { CUSTOM_FIELD_TYPES, type CustomField, type CustomFieldType } from "@/lib/customFields";

interface CustomFieldsSchemaEditorProps {
  fields: CustomField[];
  onChange: (fields: CustomField[]) => void;
  /** Affiche une case « requis » par champ (Data / formulaires). */
  allowRequired?: boolean;
  /** Affiche une case « table » par champ — champ visible dans la vue table compacte (Data). */
  allowPrimary?: boolean;
  /** Clés interdites (ex: Data → "set_tag", "category"). */
  reservedKeys?: string[];
  readOnly?: boolean;
}

/** Slugifie un libellé en clé valide (^[A-Za-z_][A-Za-z0-9_]*$). */
function slugifyKey(label: string): string {
  const base = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!base) return "";
  return /^[a-z_]/.test(base) ? base : `_${base}`;
}

/**
 * Éditeur de SCHÉMA de champs personnalisés typés — partagé par Bien, mission,
 * recette, MediaLibrary et DataLibrary. Définit les champs (libellé + clé + type
 * + requis optionnel). Ne saisit PAS les valeurs (voir CustomFieldValueInput).
 */
export function CustomFieldsSchemaEditor({
  fields,
  onChange,
  allowRequired = false,
  allowPrimary = false,
  reservedKeys = [],
  readOnly = false,
}: CustomFieldsSchemaEditorProps) {
  const [newLabel, setNewLabel] = useState("");
  const typeOptions = CUSTOM_FIELD_TYPES.map((t) => ({ value: t.value, label: t.label }));

  function patchField(index: number, patch: Partial<CustomField>) {
    onChange(fields.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function removeField(index: number) {
    onChange(fields.filter((_, i) => i !== index));
  }

  function addField() {
    const label = newLabel.trim();
    if (!label) return;
    let key = slugifyKey(label);
    if (!key) return;
    // Unicité + clés réservées.
    const existing = new Set([...fields.map((f) => f.key), ...reservedKeys]);
    if (existing.has(key)) {
      let n = 2;
      while (existing.has(`${key}_${n}`)) n += 1;
      key = `${key}_${n}`;
    }
    onChange([...fields, { key, label, type: "text" }]);
    setNewLabel("");
  }

  return (
    <div className="space-y-2">
      {fields.length === 0 && (
        <p className="text-xs text-muted-foreground italic">
          Aucun champ. Ajoutez-en un ci-dessous.
        </p>
      )}

      {fields.map((field, i) => (
        <div key={field.key} className="flex items-center gap-2">
          <Input
            value={field.label}
            onChange={(v) => patchField(i, { label: v })}
            placeholder="Libellé"
            disabled={readOnly}
            className="flex-1 min-w-0"
          />
          <Input
            value={field.key}
            onChange={(v) => patchField(i, { key: v.trim() })}
            placeholder="clé"
            disabled={readOnly}
            className="w-32 shrink-0 font-mono text-xs"
          />
          <div className="w-32 shrink-0">
            <Select
              value={field.type}
              onChange={(v) => patchField(i, { type: v as CustomFieldType })}
              options={typeOptions}
              disabled={readOnly}
            />
          </div>
          {allowRequired && (
            <Checkbox
              checked={!!field.required}
              onChange={(c) => patchField(i, { required: c })}
              disabled={readOnly}
              label="Requis"
            />
          )}
          {allowPrimary && (
            <Checkbox
              checked={!!field.primary}
              onChange={(c) => patchField(i, { primary: c })}
              disabled={readOnly}
              label="Table"
            />
          )}
          {!readOnly && (
            <button
              type="button"
              onClick={() => removeField(i)}
              className="shrink-0 p-1 text-muted-foreground hover:text-danger-600 rounded"
              aria-label={`Supprimer ${field.label}`}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ))}

      {!readOnly && (
        <div className="flex items-center gap-2 pt-1">
          <Input
            value={newLabel}
            onChange={setNewLabel}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addField();
              }
            }}
            placeholder="Nom du champ…"
            className="flex-1"
          />
          <button
            type="button"
            onClick={addField}
            disabled={!newLabel.trim()}
            className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-primary border border-input rounded-md hover:bg-muted disabled:opacity-40"
          >
            <Plus size={12} /> Ajouter
          </button>
        </div>
      )}
    </div>
  );
}
