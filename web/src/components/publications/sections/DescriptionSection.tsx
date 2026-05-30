"use client";

/**
 * DescriptionSection — section "Légende Instagram" de la fiche publication.
 *
 * Phase 2.1 : fusion ancien champ `slot.caption` (Légende IG) + `slot.description`
 * (description IA) → champ unique `slot.description`. La CaptionIgSection a été
 * supprimée — toute la rédaction de la légende IG passe désormais par ici, avec
 * bouton "Générer avec IA" inline. Le PATCH passe par `description` côté API.
 *
 * Phase 1.3.5.6 (historique) : migration vers le champ dédié `description` sur
 * PublicationSlot (R14 — audit UX). Avant cette phase, la description
 * était stockée dans `notes`, créant une ambiguïté avec les notes internes.
 *
 * Phase 1.9 B3 (historique) : ajout d'une modal inline "Générer avec IA" pour
 * rester dans le contexte de la fiche. Le mode standalone /descriptions reste
 * disponible pour les usages avancés (transcription, image de référence,
 * configuration fine).
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, ExternalLink, Save, Check, Sparkles, Loader2, Copy, Pencil, RefreshCw, AlertCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Section } from "@/components/ui/molecules/Section";
import { FormField } from "@/components/ui/FormField";
import { Textarea } from "@/components/ui/Textarea";
import { Alert } from "@/components/ui/Alert";
import { toast } from "@/components/ui/Toast";
import { canGenerateDescription } from "@/lib/publications/actions";

interface Props {
  slot: { id: string };
  pattern: { needsDescription: string } | null;
  /** Valeur initiale = slot.description ?? "" */
  initialDescription: string;
  /** true pour CM et ADMIN */
  canEdit: boolean;
  /**
   * Prompt à pré-sélectionner dans la modal IA. Résolu côté serveur :
   * slot.descriptionPromptIdOverride ?? pattern.descriptionPromptId ?? null.
   * Si null, on retombe sur le premier prompt actif disponible.
   */
  defaultPromptId?: string | null;
  /** Status du dernier DescriptionJob auto lié au slot (QUEUED/PROCESSING/COMPLETED/FAILED). */
  descriptionJobStatus?: string | null;
  /** Texte généré par le dernier DescriptionJob auto. Utilisé pour fallback :
   *  si slot.description est vide mais qu'un job COMPLETED a un result, on
   *  propose à l'user d'appliquer ce texte. Couvre le cas où l'update DB du
   *  slot a été skippé (race avec saisie manuelle, write contention, etc.). */
  descriptionJobResult?: string | null;
  /** Message d'erreur du dernier DescriptionJob FAILED. Affiché tel quel à
   *  l'user pour qu'il comprenne pourquoi la chaîne est cassée
   *  (prompt manquant, transcription absente, clé API, etc.). */
  descriptionJobErrorMsg?: string | null;
  /** Status courant du slot (TO_DO, AWAITING_CLIENT, SCHEDULED…). */
  slotStatus?: string | null;
  /** Si true, la description auto attend la validation client avant lancement. */
  needsClientValidation?: boolean;
  sectionId?: string;
  storageKey?: string;
  defaultOpen?: boolean;
  collapsible?: boolean;
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

export function DescriptionSection(props: Props) {
  // Si pas de pattern ou que le pattern indique que la description n'est pas nécessaire, on masque
  if (!props.pattern || props.pattern.needsDescription === "none") return null;
  return <DescriptionSectionInner {...props} />;
}

function DescriptionSectionInner({
  slot,
  pattern,
  initialDescription,
  canEdit,
  defaultPromptId,
  descriptionJobStatus,
  descriptionJobResult,
  descriptionJobErrorMsg,
  slotStatus,
  needsClientValidation,
  sectionId = "description",
  storageKey,
  defaultOpen = true,
  collapsible = false,
}: Props) {
  const router = useRouter();
  const isAutoMode = pattern?.needsDescription === "autoGenerate";
  const hasContent = initialDescription.trim().length > 0;
  // En mode auto + contenu déjà généré : on ouvre en preview (non-éditable).
  // Sinon (manuel / pas de contenu) : edit direct.
  const [editing, setEditing] = useState(!isAutoMode || !hasContent);
  const [copied, setCopied] = useState(false);
  const [retryingChain, setRetryingChain] = useState(false);
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

  // renderId n'est pas consommé par /descriptions (audit nav 2026-05-28) —
  // on l'omet pour ne pas laisser un param fantôme dans l'URL.
  const descriptionToolHref = `/descriptions?slotId=${slot.id}&returnTo=/publications/${slot.id}`;

  // Fetch prompts seulement à l'ouverture du modal — ne PAS dépendre de
  // selectedPromptId (sinon chaque sélection dans le dropdown re-déclenche
  // un fetch + spinner flash). L'init du selectedPromptId se fait via
  // setter fonctionnel pour éviter d'overrider un choix utilisateur en cours.
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
        if (data.length > 0) {
          setSelectedPromptId((current) => {
            if (current) return current;
            const matchDefault = defaultPromptId
              ? data.find((p) => p.id === defaultPromptId)
              : null;
            return matchDefault?.id ?? data[0].id;
          });
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
  }, [showAi, defaultPromptId]);

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

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Légende copiée — prête à coller dans Instagram.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Impossible de copier — copiez manuellement.");
    }
  }

  // ─── États du mode auto sans contenu ──────────────────────────────────────
  // Précédence : awaiting validation > job en cours > job échec > en attente lancement.
  const jobInFlight =
    descriptionJobStatus === "QUEUED" || descriptionJobStatus === "PROCESSING";
  const jobFailed = descriptionJobStatus === "FAILED";
  // SCHEDULED/PUBLISHED/CANCELLED/ARCHIVED/CLIENT_REVISION → post-validation côté machine
  const POST_VALIDATION_STATUSES = new Set([
    "SCHEDULED",
    "PUBLISHED",
    "CANCELLED",
    "ARCHIVED",
  ]);
  const waitingForClient =
    isAutoMode &&
    needsClientValidation === true &&
    !!slotStatus &&
    !POST_VALIDATION_STATUSES.has(slotStatus);

  // Cas particulier : descriptionJob COMPLETED avec result, mais slot vide
  // (race condition, update skip, ou édition manuelle entre-temps réinitialisée).
  // On affiche le texte généré avec un bouton "Appliquer" pour le récupérer.
  const pendingJobResult =
    isAutoMode &&
    !hasContent &&
    descriptionJobStatus === "COMPLETED" &&
    descriptionJobResult != null &&
    descriptionJobResult.trim().length > 0
      ? descriptionJobResult
      : null;

  async function handleRetryChain() {
    setRetryingChain(true);
    try {
      const res = await fetch(`/api/publications/${slot.id}/trigger-description`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        path?: string;
        mode?: "local" | "runpod";
      };
      if (!res.ok) {
        toast.error(data.error ?? `Erreur ${res.status}`);
        return;
      }
      const modeSuffix = data.mode === "local" ? " (mode local)" : data.mode === "runpod" ? " (mode RunPod)" : "";
      const label =
        data.path === "description_only"
          ? "Description relancée."
          : data.path === "transcription_started"
            ? `Transcription lancée${modeSuffix} — la description se déclenchera automatiquement à la fin.`
            : "Transcription déjà en cours.";
      toast.success(label);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur réseau");
    } finally {
      setRetryingChain(false);
    }
  }

  async function handleApplyGeneratedResult() {
    if (!pendingJobResult) return;
    setValue(pendingJobResult);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/calendar/slots/${slot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: pendingJobResult }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Erreur lors de l'application");
      }
      toast.success("Légende appliquée.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setSaving(false);
    }
  }

  const verdict = canGenerateDescription({
    pattern: pattern
      ? {
          source: "auto_template",
          needsCaptions: false,
          needsDescription: pattern.needsDescription,
          coverMode: "none",
        }
      : null,
    resolved: null,
    render: null,
    currentVersion: null,
    coverPack: null,
    latestCaptionJob: null,
    isAdmin: canEdit,
    canEdit,
  });

  const headerActions = (
    <>
      {verdict.visible && verdict.enabled && (
        <button
          type="button"
          onClick={() => setShowAi(true)}
          className="inline-flex items-center gap-1.5 text-[11px] text-gray-700 hover:text-gray-950 font-medium transition-colors"
        >
          <Sparkles size={12} />
          Générer avec IA
        </button>
      )}
      {verdict.visible && !verdict.enabled && (
        <span
          className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.14em] text-gray-600 bg-white/60 backdrop-blur-[6px] border border-white/50 rounded-full px-2 py-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]"
          title={verdict.reason}
        >
          <Sparkles size={10} />
          Auto
        </span>
      )}
      <Link
        href={descriptionToolHref}
        className="inline-flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
        title="Configuration avancée (transcription, image de référence, modèle)"
      >
        <ExternalLink size={12} />
        Avancé
      </Link>
    </>
  );

  const modeDescription = pattern?.needsDescription && pattern.needsDescription !== "none"
    ? `Mode : ${DESCRIPTION_MODE_LABELS[pattern.needsDescription] ?? pattern.needsDescription}`
    : undefined;

  return (
    <Section
      title="Légende Instagram"
      icon={FileText}
      description={modeDescription}
      sectionId={sectionId}
      storageKey={storageKey}
      defaultOpen={defaultOpen}
      collapsible={collapsible}
      actions={headerActions}
    >
      <div className="space-y-3">
        {/* ── Mode auto : pas encore de contenu ──────────────────────────── */}
        {isAutoMode && !hasContent ? (
          <>
            {waitingForClient && (
              <Alert variant="glass" icon={ShieldCheck}>
                La légende sera générée automatiquement après la validation client.
              </Alert>
            )}
            {!waitingForClient && pendingJobResult && (
              <>
                <Alert variant="glass" icon={Sparkles}>
                  Une légende a été générée automatiquement mais n&apos;a pas été appliquée
                  (édition manuelle simultanée ou conflit). Tu peux l&apos;appliquer maintenant.
                </Alert>
                <div className="rounded-lg border border-white/40 bg-white/70 backdrop-blur-[6px] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
                  <p className="text-[12.5px] text-gray-800 whitespace-pre-wrap leading-relaxed font-mono">
                    {pendingJobResult}
                  </p>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      icon={Check}
                      loading={saving}
                      onClick={() => void handleApplyGeneratedResult()}
                    >
                      Appliquer cette légende
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={Pencil}
                      onClick={() => {
                        setValue(pendingJobResult);
                        setEditing(true);
                      }}
                    >
                      Éditer avant
                    </Button>
                  </div>
                )}
                {error && (
                  <p className="text-xs text-danger-700">{error}</p>
                )}
              </>
            )}
            {!waitingForClient && !pendingJobResult && jobInFlight && (
              <Alert variant="glass" icon={Loader2}>
                Génération en cours…
              </Alert>
            )}
            {!waitingForClient && !pendingJobResult && jobFailed && (
              <>
                <Alert variant="info" icon={AlertCircle}>
                  <div className="space-y-1">
                    <p className="font-medium">Échec de la génération automatique.</p>
                    {descriptionJobErrorMsg && (
                      <p className="text-[12px] opacity-90">{descriptionJobErrorMsg}</p>
                    )}
                  </div>
                </Alert>
                {canEdit && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={RefreshCw}
                      loading={retryingChain}
                      onClick={() => void handleRetryChain()}
                      title="Lance la transcription si absente, puis enchaîne la description"
                    >
                      Relancer la chaîne
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Sparkles}
                      onClick={() => setShowAi(true)}
                    >
                      Générer manuellement
                    </Button>
                  </div>
                )}
              </>
            )}
            {!waitingForClient && !pendingJobResult && !jobInFlight && !jobFailed && (
              <>
                <Alert variant="glass" icon={Sparkles}>
                  La chaîne ne semble pas avoir démarré (transcription absente
                  ou pipeline interrompu). Clique sur « Lancer la chaîne »
                  pour déclencher transcription + description.
                </Alert>
                {canEdit && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={RefreshCw}
                      loading={retryingChain}
                      onClick={() => void handleRetryChain()}
                      title="Lance la transcription si absente, puis enchaîne la description"
                    >
                      Lancer la chaîne
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Sparkles}
                      onClick={() => setShowAi(true)}
                    >
                      Générer manuellement
                    </Button>
                  </div>
                )}
              </>
            )}
          </>
        ) : isAutoMode && hasContent && !editing ? (
          /* ── Mode auto + contenu : preview + 2 icônes discrètes ──────────── */
          <>
            <div className="rounded-lg border border-white/40 bg-white/70 backdrop-blur-[6px] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
              <p className="text-[12.5px] text-gray-800 whitespace-pre-wrap leading-relaxed font-mono">
                {value}
              </p>
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-gray-400">{value.length} / 2 200 caractères</p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void handleCopy()}
                  className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-800 px-2 py-1 rounded transition-colors"
                  title="Copier la légende"
                  aria-label="Copier la légende"
                >
                  {copied ? <Check size={12} className="text-success-700" /> : <Copy size={12} />}
                  {copied ? "Copié" : "Copier"}
                </button>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-800 px-2 py-1 rounded transition-colors"
                    title="Modifier la légende"
                    aria-label="Modifier la légende"
                  >
                    <Pencil size={12} />
                    Modifier
                  </button>
                )}
              </div>
            </div>
          </>
        ) : (
          /* ── Mode manuel OU édition après preview ─────────────────────────── */
          <>
            <Textarea
              value={value}
              onChange={(v) => {
                setValue(v);
                setSaved(false);
              }}
              disabled={!canEdit || saving}
              rows={6}
              placeholder={
                canEdit
                  ? "Rédigez la légende Instagram de la publication…\n\n#immobilier #realestate"
                  : "Aucune légende renseignée."
              }
              error={error ?? undefined}
              className="font-mono leading-relaxed"
            />

            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-gray-400">{value.length} / 2 200 caractères</p>
              {isAutoMode && hasContent && (
                <button
                  type="button"
                  onClick={() => {
                    setValue(initialDescription);
                    setEditing(false);
                  }}
                  className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-800 px-2 py-1 rounded transition-colors"
                  title="Annuler l'édition"
                >
                  <RefreshCw size={12} />
                  Annuler
                </button>
              )}
            </div>

            {canEdit && (
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  icon={saved ? Check : Save}
                  loading={saving}
                  disabled={!isDirty}
                  onClick={async () => {
                    await handleSave();
                    // En mode auto + contenu : on retourne en preview après save
                    if (isAutoMode && value.trim().length > 0) setEditing(false);
                  }}
                >
                  {saved ? "Enregistré" : "Enregistrer"}
                </Button>

                {saved && (
                  <span className="text-xs text-success-700">Légende sauvegardée.</span>
                )}
              </div>
            )}
          </>
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
                  <Sparkles size={16} className="text-gray-700" />
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
                    Une légende existe déjà — la génération va l&apos;écraser.
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
                    <p className="text-sm text-danger-700 py-2">{promptsError}</p>
                  ) : prompts.length === 0 ? (
                    <p className="text-sm text-gray-500 py-2">
                      Aucun prompt actif. Vérifie que tes prompts sont activés (icône œil)
                      depuis{" "}
                      <Link href="/admin/prompts" className="text-gray-950 underline hover:no-underline">
                        /admin/prompts
                      </Link>
                      .
                    </p>
                  ) : (
                    <select
                      value={selectedPromptId}
                      onChange={(e) => setSelectedPromptId(e.target.value)}
                      className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus-ring"
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

                {genError && <p className="text-xs text-danger-700">{genError}</p>}
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
    </Section>
  );
}
