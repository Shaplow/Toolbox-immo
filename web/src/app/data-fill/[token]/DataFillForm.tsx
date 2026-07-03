"use client";

/**
 * Form publique de remplissage (Phase 1.x Vague 3).
 *
 * Construit dynamiquement les inputs depuis fieldsSchema. Permet d'ajouter
 * plusieurs fiches en une soumission. POST /api/data-fill/[token].
 */

import { useState, useMemo } from "react";
import { Plus, Send, Trash2, Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";
import { toast } from "@/components/ui/Toast";
import type { CustomField } from "@/lib/customFields";
import { normalizeCustomFields } from "@/lib/customFields";
import { CustomFieldValueInput } from "@/components/fields/CustomFieldValueInput";

// Alias local pour compatibilité avec les usages existants dans ce fichier.
type FieldDef = CustomField;

interface EntryDraft {
  setTag: string;
  category: string;
  fields: Record<string, string>;
}

function blankEntry(schema: FieldDef[]): EntryDraft {
  const fields: Record<string, string> = {};
  for (const f of schema) fields[f.key] = "";
  return { setTag: "", category: "", fields };
}

interface Props {
  token: string;
  fieldsSchema: string;
}

export function DataFillForm({ token, fieldsSchema }: Props) {
  const schema = useMemo(() => normalizeCustomFields(fieldsSchema), [fieldsSchema]);
  const [entries, setEntries] = useState<EntryDraft[]>([blankEntry(schema)]);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ count: number } | null>(null);

  function addRow() {
    setEntries((prev) => [...prev, blankEntry(schema)]);
  }
  function removeRow(idx: number) {
    setEntries((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));
  }
  function updateRow(idx: number, patch: Partial<EntryDraft>) {
    setEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  }
  function updateField(idx: number, key: string, value: string) {
    setEntries((prev) =>
      prev.map((e, i) => (i === idx ? { ...e, fields: { ...e.fields, [key]: value } } : e)),
    );
  }

  async function handleSubmit() {
    // Validation locale : champs requis
    for (const [i, e] of entries.entries()) {
      for (const f of schema) {
        if (f.required && !e.fields[f.key]?.trim()) {
          toast.error(`Fiche #${i + 1} : « ${f.label} » est requis`);
          return;
        }
      }
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/data-fill/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entries: entries.map((e) => ({
            setTag: e.setTag.trim() || null,
            category: e.category.trim() || null,
            fields: e.fields,
          })),
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        toast.error(data.error ?? "Erreur lors de l'envoi");
        return;
      }
      const data = (await res.json()) as { created: number };
      setSuccess({ count: data.created });
      setEntries([blankEntry(schema)]);
    } catch (err) {
      console.error("[DataFillForm] submit error:", err);
      toast.error("Erreur réseau");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="rounded-3xl bg-gradient-to-b from-success-50/85 to-success-50/55 p-6 sm:p-8  text-center">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-success-100 text-success-700 mb-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
          <Check size={22} />
        </div>
        <h2 className="text-[18px] font-semibold text-success-700">
          {success.count} fiche{success.count !== 1 ? "s" : ""} envoyée{success.count !== 1 ? "s" : ""}
        </h2>
        <p className="mt-2 text-[13px] text-success-700/80">
          Merci&nbsp;! L&apos;équipe va les retrouver dans son admin.
        </p>
        <Button variant="ghost" onClick={() => setSuccess(null)} className="mt-4">
          Ajouter d&apos;autres fiches
        </Button>
      </div>
    );
  }

  if (schema.length === 0) {
    return (
      <div className="rounded-2xl bg-card border border-border p-6 text-center ">
        <p className="text-[13px] text-muted-foreground">
          Cette bibliothèque n&apos;a pas encore de schéma de champs défini.
          <br />
          Demande à l&apos;équipe qu&apos;elle configure les champs avant de remplir.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {entries.map((entry, idx) => (
        <div
          key={idx}
          className="rounded-2xl bg-card border border-border p-4 sm:p-5  relative"
        >
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] uppercase tracking-widest font-semibold text-muted-foreground">
              Fiche {idx + 1}
            </p>
            {entries.length > 1 && (
              <button
                type="button"
                onClick={() => removeRow(idx)}
                className="p-1 text-muted-foreground/60 hover:text-danger-600 transition-colors"
                title="Supprimer cette fiche"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <FormField label="Set (optionnel)">
              <Input
                value={entry.setTag}
                onChange={(v) => updateRow(idx, { setTag: v })}
                placeholder="ex: set1"
              />
            </FormField>
            <FormField label="Catégorie (optionnel)">
              <Input
                value={entry.category}
                onChange={(v) => updateRow(idx, { category: v })}
                placeholder="ex: tenue1"
              />
            </FormField>
          </div>

          <div className="space-y-2.5">
            {schema.map((f) => (
              <FormField key={f.key} label={f.label} required={f.required}>
                <CustomFieldValueInput
                  field={f}
                  value={entry.fields[f.key] ?? ""}
                  onChange={(v) => updateField(idx, f.key, v)}
                />
              </FormField>
            ))}
          </div>
        </div>
      ))}

      <div className="flex items-center justify-between gap-3 pt-2">
        <Button variant="ghost" icon={Plus} onClick={addRow} disabled={submitting}>
          Ajouter une fiche
        </Button>
        <Button
          variant="primary"
          icon={Send}
          onClick={() => void handleSubmit()}
          loading={submitting}
          disabled={entries.length === 0}
        >
          Envoyer ({entries.length})
        </Button>
      </div>
    </div>
  );
}
