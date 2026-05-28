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

import { useEffect, useRef, useState } from "react";
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
  /**
   * Prompt à pré-sélectionner dans la modal IA. Résolu côté serveur :
   * slot.descriptionPromptIdOverride ?? pattern.descriptionPromptId ?? null.
   * Si null, on retombe sur le premier prompt actif disponible.
   */
  defaultPromptId?: string | null;
}

interface PromptOption {
  id: string;
  name: string;
}

/** Libellés français pour les modes de description (sinon on affiche les
 *  codes camelCase bruts dans l'en-tête de section). */
const DESCRIPTION_MODE_LABELS: Record<string, string> = {
  preFilled: "pré-remplie",
  autoGenerate: "auto-générée",
  manualWrite: "manuelle",
};

export function DescriptionSection({
  slot,
  pattern,
  initialDescription,
  canEdit,
  renderId,
  defaultPromptId,
}: Props) {
  // Si pas de pattern ou que le pattern indique que la description n'est pas nécessaire, on masque
  if (!pattern || pattern.needsDescription === "none") return null;

  return <DescriptionSectionInner
    slot={slot}
    pattern={pattern}
    initialDescription={initialDescription}
    canEdit={canEdit}
    renderId={renderId}
    defaultPromptId={defaultPromptId}
  />;
}

function DescriptionSectionInner({
  slot,
  pattern,
  initialDescription,
  canEdit,
  renderId,
  defaultPromptId,
}: Props) {
  const [value, setValue] = useState(initialDescription);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resync de la prop quand le serveur refresh (navigation soft, refetch).
  // On garde une ref de la dernière valeur initiale "connue" : si l'user
  // n'a rien tapé (value === lastKnownInitial), on re-sync ; sinon on
  // préserve sa frappe en cours pour ne pas écraser une édition.
  const lastInitialRef = useRef(initialDescription);
  useEffect(() => {
    if (lastInitialRef.current === initialDescription) return;
    if (value === lastInitialRef.current) {
      setValue(initialDescription);
    }
    lastInitialRef.current = initialDescription;
  }, [initialDescription, value]);

  // Modal IA inline
  const [showAi, setShowAi] = useState(false);
  const [prompts, setPrompts] = useState<PromptOption[]>([]);
  const [promptsLoading, setPromptsLoading] = useState(false);
  const [promptsError, setPromptsError] = useState<string | null>(null);
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
    setPromptsError(null);
    (async () => {
      try {
        const res = await fetch("/api/description/prompts");
        if (!res.ok) throw new Error(`Impossible de charger les prompts (HTTP ${res.status}).`);
        const data = (await res.json()) as PromptOption[];
        if (cancelled) return;
        setPrompts(data);
        if (data.length > 0 && !selectedPromptId) {
          const matchDefault = defaultPromptId
            ? data.find((p) => p.id === defaultPromptId)
            : null;
          setSelectedPromptId(matchDefault?.id ?? data[0].id);
        }
      } catch (err) {
        if (!cancelled) {
          setPromptsError(err instanceof Error ? err.message : "Erreur de chargement des prompts.");
        }
      } finally {
        if (!cancelled) setPromptsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showAi, selectedPromptId, defaultPromptId]);

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
            <span className="text-xs text-gray-400 italic">
              ({DESCRIPTION_MODE_LABELS[pattern.needsDescription] ?? pattern.needsDescription})
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* "Générer avec IA" : visible uniquement pour les modes manuels
              (manualWrite). Pour autoGenerate, le job est déclenché par le
              backend après render ; pour preFilled, le texte est pré-rempli
              depuis la bibliothèque — proposer un bouton manuel à côté
              donnerait l'impression que rien ne tourne en arrière-plan. */}
          {canEdit && pattern?.needsDescription === "manualWrite" && (
            <button
              type="button"
              onClick={() => setShowAi(true)}
              className="inline-flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-700 font-medium transition-colors"
            >
              <Sparkles size={12} />
              Générer avec IA
            </button>
          )}
          {canEdit && pattern?.needsDescription === "autoGenerate" && (
            <span
              className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-2 py-0.5"
              title="Cette description est générée automatiquement après le rendu vidéo."
            >
              <Sparkles size={10} />
              Auto
            </span>
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
                {/* F1.1 — Avertissement si une description existe déjà : la
                     génération va écraser le texte courant. */}
                {value.trim().length > 0 && (
                  <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    Une description existe déjà — la génération va l&apos;écraser.
                    Tu pourras toujours annuler en fermant la modale.
                  </p>
                )}
              </div>
              <div className="px-6 pb-4 space-y-3">
                <FormField label="Prompt" required>
                  {promptsLoading ? (
                    <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
                      <Loader2 size={14} className="animate-spin" /> Chargement…
                    </div>
                  ) : promptsError ? (
                    <p className="text-sm text-red-600 py-2">{promptsError}</p>
                  ) : prompts.length === 0 ? (
                    <p className="text-sm text-gray-500 py-2">
                      Aucun prompt actif. Vérifie que tes prompts sont activés (icône œil)
                      depuis{" "}
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
