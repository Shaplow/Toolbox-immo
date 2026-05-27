"use client";

/**
 * DescriptionSection — section "Description" de la fiche publication.
 *
 * Phase 1.3.5.6 : migration vers le champ dédié `description` sur
 * PublicationSlot (R14 — audit UX). Avant cette phase, la description
 * était stockée dans `notes`, créant une ambiguïté avec les notes internes.
 *
 * Phase 1.9 B3 : ajout d'une modal inline "Générer avec IA" pour rester
 * dans le contexte de la fiche. Le mode standalone /descriptions reste
 * disponible pour les usages avancés (transcription, image de référence,
 * configuration fine).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileText, ExternalLink, Save, Check, Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import { Textarea } from "@/components/ui/Textarea";

interface Props {
  slot: { id: string };
  pattern: { needsDescription: string } | null;
  /** Valeur initiale = slot.description ?? "" */
  initialDescription: string;
  /** true pour CM et ADMIN */
  canEdit: boolean;
  renderId: string | null;
}

interface PromptOption {
  id: string;
  name: string;
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

  // Modal IA inline
  const [showAi, setShowAi] = useState(false);
  const [prompts, setPrompts] = useState<PromptOption[]>([]);
  const [promptsLoading, setPromptsLoading] = useState(false);
  const [selectedPromptId, setSelectedPromptId] = useState("");
  const [aiPersonalization, setAiPersonalization] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const descriptionToolHref = renderId
    ? `/descriptions?slotId=${slot.id}&renderId=${renderId}&returnTo=/publications/${slot.id}`
    : `/descriptions?slotId=${slot.id}&returnTo=/publications/${slot.id}`;

  useEffect(() => {
    if (!showAi) return;
    let cancelled = false;
    setPromptsLoading(true);
    setGenError(null);
    (async () => {
      try {
        const res = await fetch("/api/description/prompts");
        if (!res.ok) throw new Error("Impossible de charger les prompts.");
        const data = (await res.json()) as PromptOption[];
        if (cancelled) return;
        setPrompts(data);
        if (data.length > 0 && !selectedPromptId) {
          setSelectedPromptId(data[0].id);
        }
      } catch (err) {
        if (!cancelled) {
          setGenError(err instanceof Error ? err.message : "Erreur de chargement.");
        }
      } finally {
        if (!cancelled) setPromptsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showAi, selectedPromptId]);

  // ESC pour fermer
  useEffect(() => {
    if (!showAi) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !generating) setShowAi(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showAi, generating]);

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

  async function handleGenerate() {
    if (!selectedPromptId) {
      setGenError("Sélectionnez un prompt.");
      return;
    }
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetch("/api/description/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promptId: selectedPromptId,
          personalization: aiPersonalization.trim() || undefined,
          model: "claude",
          slotId: slot.id,
        }),
      });
      const data = (await res.json()) as { result?: string; error?: string };
      if (!res.ok || !data.result) {
        throw new Error(data.error ?? "Échec de la génération.");
      }
      setValue(data.result);
      setSaved(false);
      setShowAi(false);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Erreur inconnue.");
    } finally {
      setGenerating(false);
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

        <div className="flex items-center gap-3">
          {canEdit && (
            <button
              type="button"
              onClick={() => setShowAi(true)}
              className="inline-flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-700 font-medium transition-colors"
            >
              <Sparkles size={12} />
              Générer avec IA
            </button>
          )}

          {/* Lien vers l'outil standalone (config avancée : transcription, image, modèle…) */}
          <Link
            href={descriptionToolHref}
            className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
            title="Configuration avancée (transcription, image de référence, modèle)"
          >
            <ExternalLink size={12} />
            Avancé
          </Link>
        </div>
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

      {/* Modal IA inline */}
      {showAi && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40"
            onClick={() => !generating && setShowAi(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-description-title"
            className="fixed inset-0 z-50 flex items-center justify-center px-4 pointer-events-none"
          >
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg pointer-events-auto overflow-hidden">
              <div className="px-6 pt-6 pb-3">
                <h2 id="ai-description-title" className="text-base font-semibold text-gray-900 mb-1 flex items-center gap-2">
                  <Sparkles size={16} className="text-indigo-500" />
                  Générer avec IA
                </h2>
                <p className="text-sm text-gray-600">
                  Génération rapide via Claude. Pour utiliser une transcription
                  ou une image de référence, ouvrez la configuration avancée.
                </p>
              </div>
              <div className="px-6 pb-4 space-y-3">
                <FormField label="Prompt" required>
                  {promptsLoading ? (
                    <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
                      <Loader2 size={14} className="animate-spin" /> Chargement…
                    </div>
                  ) : prompts.length === 0 ? (
                    <p className="text-sm text-gray-500 py-2">
                      Aucun prompt actif. Créez-en un depuis{" "}
                      <Link href="/admin/prompts" className="text-indigo-600 hover:underline">
                        /admin/prompts
                      </Link>
                      .
                    </p>
                  ) : (
                    <select
                      value={selectedPromptId}
                      onChange={(e) => setSelectedPromptId(e.target.value)}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    >
                      {prompts.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  )}
                </FormField>

                <FormField label="Détails additionnels" help="Optionnel — ajouter du contexte au prompt">
                  <Textarea
                    value={aiPersonalization}
                    onChange={setAiPersonalization}
                    rows={3}
                    placeholder="Ex. mettre en avant l'exposition sud, ne pas mentionner le prix…"
                  />
                </FormField>

                {genError && <p className="text-xs text-red-600">{genError}</p>}
              </div>
              <div className="flex items-center justify-end gap-2 px-6 py-4 bg-gray-50 border-t border-gray-100">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setShowAi(false)}
                  disabled={generating}
                >
                  Annuler
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => void handleGenerate()}
                  loading={generating}
                  disabled={prompts.length === 0 || !selectedPromptId}
                  icon={Sparkles}
                >
                  Générer
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
