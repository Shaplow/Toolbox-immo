"use client";

/**
 * CaptionIgSection — section "Légende Instagram" de la fiche publication.
 *
 * Permet d'éditer la légende Instagram du slot via PATCH /api/calendar/slots/[id].
 * Le champ `caption` est autorisé pour le rôle CM et ADMIN côté serveur.
 */

import { useEffect, useRef, useState } from "react";
import { MessageSquare, Save, Check, Copy } from "lucide-react";

interface Props {
  slot: { id: string; caption: string | null };
  /** Description du slot (notes) pour le bouton "Reprendre depuis description" */
  description: string | null;
  /** true pour CM et ADMIN */
  canEdit: boolean;
}

export function CaptionIgSection({ slot, description, canEdit }: Props) {
  const initial = slot.caption ?? "";
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resync de la prop quand le serveur refresh : si l'user n'a pas
  // modifié localement, on suit la nouvelle valeur ; sinon on préserve
  // l'édition en cours (pas d'écrasement silencieux).
  const lastInitialRef = useRef(initial);
  useEffect(() => {
    if (lastInitialRef.current === initial) return;
    if (value === lastInitialRef.current) {
      setValue(initial);
    }
    lastInitialRef.current = initial;
  }, [initial, value]);

  const isDirty = value !== initial;

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/calendar/slots/${slot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption: value || null }),
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

  function handleCopyFromDescription() {
    if (description) {
      setValue(description);
      setSaved(false);
    }
  }

  return (
    <section id="caption-ig" className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm">
      {/* En-tête section */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <MessageSquare size={16} className="text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-700">Légende Instagram</h2>
        </div>

        {/* Reprendre depuis description */}
        {canEdit && description && (
          <button
            type="button"
            onClick={handleCopyFromDescription}
            className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-indigo-600 transition-colors"
          >
            <Copy size={12} />
            Copier depuis description
          </button>
        )}
      </div>

      <div className="space-y-3">
        <textarea
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
          disabled={!canEdit || saving}
          rows={6}
          placeholder={
            canEdit
              ? "Rédigez la légende Instagram de la publication…\n\n#immobilier #realestate"
              : "Aucune légende renseignée."
          }
          className={`w-full border rounded-lg px-3 py-2 text-sm resize-y font-mono leading-relaxed transition-colors ${
            canEdit
              ? "border-gray-200 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 focus:outline-none text-gray-700"
              : "border-gray-100 bg-gray-50 text-gray-600 cursor-default"
          } disabled:opacity-70`}
        />

        {/* Compteur de caractères */}
        <p className="text-xs text-gray-400 text-right">{value.length} / 2 200 caractères</p>

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
              {saving ? "Enregistrement…" : saved ? "Enregistrée" : "Enregistrer"}
            </button>

            {saved && (
              <span className="text-xs text-green-600">Légende sauvegardée.</span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
