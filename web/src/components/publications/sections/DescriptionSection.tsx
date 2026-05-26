"use client";

/**
 * DescriptionSection — section "Description" de la fiche publication.
 *
 * Phase 1.3.5.6 : migration vers le champ dédié `description` sur
 * PublicationSlot (R14 — audit UX). Avant cette phase, la description
 * était stockée dans `notes`, créant une ambiguïté avec les notes internes.
 *
 * Le PATCH cible désormais le champ `description` exclusivement.
 * Le champ `notes` reste intact et accessible via d'autres usages internes.
 *
 * Si needsDescription === "none", la section est masquée.
 */

import { useState } from "react";
import Link from "next/link";
import { FileText, ExternalLink, Save, Check } from "lucide-react";

interface Props {
  slot: { id: string };
  pattern: { needsDescription: string } | null;
  /** Valeur initiale = slot.description ?? "" */
  initialDescription: string;
  /** true pour CM et ADMIN */
  canEdit: boolean;
  renderId: string | null;
}

export function DescriptionSection({ slot, pattern, initialDescription, canEdit, renderId }: Props) {
  // Si pas de pattern ou que le pattern indique que la description n'est pas nécessaire, on masque
  if (!pattern || pattern.needsDescription === "none") return null;

  return <DescriptionSectionInner
    slot={slot}
    pattern={pattern}
    initialDescription={initialDescription}
    canEdit={canEdit}
    renderId={renderId}
  />;
}

function DescriptionSectionInner({ slot, pattern, initialDescription, canEdit, renderId }: Props) {
  const [value, setValue] = useState(initialDescription);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const descriptionToolHref = renderId
    ? `/tools/description?slotId=${slot.id}&renderId=${renderId}&returnTo=/publications/${slot.id}`
    : `/tools/description?slotId=${slot.id}&returnTo=/publications/${slot.id}`;

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/calendar/slots/${slot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: value || null }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Erreur lors de l'enregistrement");
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setSaving(false);
    }
  }

  const isDirty = value !== initialDescription;

  return (
    <section id="description" className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm">
      {/* En-tête section */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-700">Description</h2>
          {pattern?.needsDescription && pattern.needsDescription !== "none" && (
            <span className="text-xs text-gray-400 italic">({pattern.needsDescription})</span>
          )}
        </div>

        {/* Lien vers l'outil description IA */}
        <Link
          href={descriptionToolHref}
          className="inline-flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-700 transition-colors"
        >
          <ExternalLink size={12} />
          Outil IA
        </Link>
      </div>

      <div className="space-y-3">
        <textarea
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
          disabled={!canEdit || saving}
          rows={5}
          placeholder={
            canEdit
              ? "Rédigez la description de la publication…"
              : "Aucune description renseignée."
          }
          className={`w-full border rounded-lg px-3 py-2 text-sm resize-y transition-colors ${
            canEdit
              ? "border-gray-200 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 focus:outline-none text-gray-700"
              : "border-gray-100 bg-gray-50 text-gray-600 cursor-default"
          } disabled:opacity-70`}
        />

        {error && (
          <p className="text-xs text-red-600">{error}</p>
        )}

        {canEdit && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !isDirty}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saved ? <Check size={14} /> : <Save size={14} />}
              {saving ? "Enregistrement…" : saved ? "Enregistré" : "Enregistrer"}
            </button>

            {saved && (
              <span className="text-xs text-green-600">Description sauvegardée.</span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
