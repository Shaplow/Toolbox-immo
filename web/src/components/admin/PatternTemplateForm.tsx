"use client";

/**
 * PatternTemplateForm — formulaire de création/édition d'une recette
 * éditoriale globale (PatternTemplate). Les 18 champs de contenu sont
 * portés par <PatternTemplateFields> (partagé avec l'onglet Contenu de
 * RecipeForm — cf. components/admin/shared/PatternTemplateFields.tsx) ; ce
 * composant ajoute par-dessus ce qui est spécifique au catalogue : auto-save
 * des champs SAFE en édition, ConfirmDialog d'impact structurant, section
 * "Comptes liés" et déploiement à N comptes.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { Sparkles, Trash2, ExternalLink, Rocket } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useAutoSave } from "@/hooks/useAutoSave";
import { dateFr } from "@/lib/date/formatFr";
import {
  PatternTemplateFields,
  decodePatternTemplateFields,
  encodePatternTemplateFieldsPayload,
  validateRecipeTemplate,
  type PatternTemplateFieldValues,
  type PatternTemplateFieldsPayload,
} from "@/components/admin/shared/PatternTemplateFields";
import { DeployTemplateModal } from "./DeployTemplateModal";

interface LinkedBinding {
  id: string;
  accountId: string;
  publishTime: string;
  isActive: boolean;
  customLabel: string | null;
  defaultAssigneeMonteurId: string | null;
  account: { id: string; name: string; handle: string };
}

export interface PatternTemplateInitial {
  id?: string;
  label: string;
  source: string;
  templateId: string | null;
  captionPresetId: string | null;
  descriptionPromptId: string | null;
  descriptionSourceFieldKey?: string | null;
  descriptionFixedText?: string | null;
  coverMode: string;
  needsDescription: string;
  needsCaptionsMode: string;
  needsAdminValidation: boolean;
  needsClientValidation: boolean;
  allowsClientRevision: boolean;
  needsBrief: boolean;
  requiresProperty?: boolean;
  /** Phase 5 (métaobjet) — remplace requiresProperty. */
  requiresEntityTypeId?: string | null;
  notes: string | null;
  bindingCount?: number;
  /** Bibliothèque vidéo cible pour l'auto-save de la sortie. null = désactivé. */
  autoSaveToLibraryId?: string | null;
  /** Comptes liés — fournis en SSR, pas de refetch lazy au montage. */
  bindings?: LinkedBinding[];
  updatedBy?: { name: string; at: string } | null;
}

export type PatternTemplateFormValues = PatternTemplateFieldsPayload;

interface PatternTemplateFormProps {
  initial: PatternTemplateInitial | null;
  templateId: string | null;
  builderTemplates: { id: string; name: string }[];
  captionPresets: { id: string; name: string }[];
  descriptionPrompts: { id: string; name: string }[];
  /** Bibliothèques de type "video" disponibles pour l'auto-save de sortie. */
  videoLibraries: { id: string; name: string }[];
  saving: boolean;
  onSave: (values: PatternTemplateFormValues) => Promise<void> | void;
  onArchive?: () => void;
  onClose: () => void;
}

/** Champs SAFE pour l'auto-save en édition — le reste reste en save manuel + ConfirmDialog d'impact. */
type PatternTemplatePatch = {
  label?: string;
  notes?: string | null;
  needsBrief?: boolean;
  requiresProperty?: boolean;
  requiresEntityTypeId?: string | null;
  needsAdminValidation?: boolean;
  needsClientValidation?: boolean;
  allowsClientRevision?: boolean;
};

export function PatternTemplateForm({
  initial,
  templateId,
  builderTemplates,
  captionPresets,
  descriptionPrompts,
  videoLibraries,
  saving,
  onSave,
  onArchive,
  onClose,
}: PatternTemplateFormProps) {
  const initialTemplateValues = useMemo(() => decodePatternTemplateFields(initial), [initial]);
  const [templateValues, setTemplateValues] = useState<PatternTemplateFieldValues>(
    initialTemplateValues,
  );
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Sprint D — confirmation impact avant save quand la recette est utilisée
  // et qu'on touche à un champ structurant.
  const [pendingValues, setPendingValues] = useState<PatternTemplateFormValues | null>(null);
  // Sprint C — modal "Déployer cette recette à N comptes".
  const [deployOpen, setDeployOpen] = useState(false);
  // Sprint B — bindings liés, fournis en SSR ; mis à jour localement après un
  // déploiement (pas de refetch lazy au montage, cf. Phase 10 V2 bug A.1
  // désormais résolu : l'initial SSR porte déjà tous les champs).
  const [linkedBindings, setLinkedBindings] = useState<LinkedBinding[]>(initial?.bindings ?? []);

  // Phase 10 V2 — auto-save sur les champs SAFE en mode édition :
  //   - label, notes, workflow toggles (needsBrief, needsAdminValidation,
  //     needsClientValidation, allowsClientRevision), requiresEntityTypeId.
  // Les champs structurants (source, templateId, presets, coverMode,
  // captionsMode, descriptionMode) restent en save manuel + ConfirmDialog
  // d'impact (le diff structurant est ce qui propage aux futurs slots).
  const autoSave = useAutoSave<PatternTemplatePatch>(
    async (patch) => {
      if (!templateId) return;
      const res = await fetch(`/api/admin/patterns/${templateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Erreur ${res.status}`);
      }
    },
    { debounceMs: 800 },
  );

  function handleTemplateFieldsChange(patch: Partial<PatternTemplateFieldValues>) {
    setTemplateValues((prev) => ({ ...prev, ...patch }));
    if (!templateId) return;
    // On enqueue les champs SAFE touchés, même vides : le serveur valide
    // (label trim() requis côté PATCH) et le statut auto-save passe à "error"
    // ce qui rend l'invalidité visible pour l'admin. Filtrer côté front
    // masquerait l'erreur et laisserait l'ancienne valeur en DB sans signal.
    const autoPatch: PatternTemplatePatch = {};
    if (patch.label !== undefined) autoPatch.label = patch.label.trim();
    if (patch.notes !== undefined) autoPatch.notes = patch.notes.trim() || null;
    if (patch.needsBrief !== undefined) autoPatch.needsBrief = patch.needsBrief;
    if (patch.requiresEntityTypeId !== undefined) {
      autoPatch.requiresProperty = !!patch.requiresEntityTypeId;
      autoPatch.requiresEntityTypeId = patch.requiresEntityTypeId || null;
    }
    if (patch.needsAdminValidation !== undefined) {
      autoPatch.needsAdminValidation = patch.needsAdminValidation;
    }
    if (patch.needsClientValidation !== undefined) {
      autoPatch.needsClientValidation = patch.needsClientValidation;
      // Désactiver needsClientValidation cascade aussi allowsClientRevision
      // (cohérence d'état — pas de révision autorisée sans validation active).
      if (!patch.needsClientValidation) autoPatch.allowsClientRevision = false;
    } else if (patch.allowsClientRevision !== undefined) {
      autoPatch.allowsClientRevision = patch.allowsClientRevision;
    }
    if (Object.keys(autoPatch).length > 0) autoSave.enqueue(autoPatch);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Flush les éventuels SAFE patches en attente avant un save manuel — sinon
    // le PATCH structurant pourrait écraser un toggle workflow encore dans la
    // fenêtre de debounce auto-save.
    if (templateId) await autoSave.flush();
    const validationError = validateRecipeTemplate(templateValues);
    if (validationError) {
      setError(validationError);
      return;
    }
    const values = encodePatternTemplateFieldsPayload(templateValues);

    // Sprint D — Si la recette est utilisée par au moins 1 binding et que
    // le diff touche un champ structurant (source, builderTemplate, presets,
    // coverMode, captions/description mode), demande confirmation explicite
    // avant de propager la modif (les futurs slots auto en hériteront).
    const bindingCount = initial?.bindingCount ?? 0;
    const initialValues = encodePatternTemplateFieldsPayload(initialTemplateValues);
    const isStructuralChange =
      templateId !== null &&
      initial !== null &&
      (initialValues.source !== values.source ||
        initialValues.templateId !== values.templateId ||
        initialValues.captionPresetId !== values.captionPresetId ||
        initialValues.descriptionPromptId !== values.descriptionPromptId ||
        initialValues.coverMode !== values.coverMode ||
        initialValues.needsCaptionsMode !== values.needsCaptionsMode ||
        initialValues.needsDescription !== values.needsDescription ||
        initialValues.descriptionSourceFieldKey !== values.descriptionSourceFieldKey ||
        initialValues.descriptionFixedText !== values.descriptionFixedText ||
        initialValues.autoSaveToLibraryId !== values.autoSaveToLibraryId);
    if (bindingCount > 0 && isStructuralChange) {
      setPendingValues(values);
      return;
    }

    void onSave(values);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-full">
      {/* Sprint D — confirmation impact pour les modifs structurantes. */}
      <ConfirmDialog
        open={pendingValues !== null}
        title="Modifier cette recette ?"
        description={`Cette recette est utilisée par ${initial?.bindingCount ?? 0} compte${(initial?.bindingCount ?? 0) > 1 ? "s" : ""}. La modification s'appliquera aux prochains slots auto-générés. Les slots existants ne sont pas affectés.`}
        confirmLabel="Confirmer la modification"
        variant="danger"
        loading={saving}
        onConfirm={async () => {
          if (!pendingValues) return;
          // Bug D.3 — Si onSave throw, on doit afficher l'erreur sinon
          // le drawer revient en mode éditable silencieusement et l'admin
          // pense que sa modif est enregistrée.
          const values = pendingValues;
          setPendingValues(null);
          try {
            setError(null);
            await onSave(values);
          } catch (err) {
            setError(
              err instanceof Error ? err.message : "Erreur de sauvegarde",
            );
          }
        }}
        onCancel={() => setPendingValues(null)}
      />

      <ConfirmDialog
        open={confirmArchive}
        title="Archiver cette recette ?"
        description="La recette disparaît du catalogue mais les comptes qui l'utilisent restent fonctionnels. Archivage réversible via l'API."
        confirmLabel="Archiver"
        variant="danger"
        loading={saving}
        onConfirm={() => {
          setConfirmArchive(false);
          if (onArchive) onArchive();
        }}
        onCancel={() => setConfirmArchive(false)}
      />

      <header className="shrink-0 px-5 pt-5 pb-3 border-b border-border">
        <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">
          {templateId ? "Édition" : "Nouvelle recette"}
        </p>
        <h2 className="mt-1 text-[20px] font-semibold tracking-tight text-foreground">
          {templateId ? templateValues.label || "Sans nom" : "Nouvelle recette"}
        </h2>
        {initial?.bindingCount !== undefined && initial.bindingCount > 0 && (
          <p className="mt-1 text-[11.5px] text-info-700">
            Utilisée par {initial.bindingCount} compte
            {initial.bindingCount > 1 ? "s" : ""}.
          </p>
        )}
        {/* Sprint D — Auteur de la dernière modification. */}
        {initial?.updatedBy && (
          <p className="mt-1 text-[10.5px] text-muted-foreground">
            Modifiée par {initial.updatedBy.name} ·{" "}
            {dateFr(initial.updatedBy.at)}
          </p>
        )}
        {/* Phase 10 V2 — indicateur auto-save discret (édition uniquement). */}
        {templateId && autoSave.status !== "idle" && (
          <span
            className={[
              "mt-2 inline-flex items-center px-2 h-6 rounded-md text-[11px] font-medium",
              autoSave.status === "saving"
                ? "text-muted-foreground bg-muted/70"
                : autoSave.status === "saved"
                  ? "text-success-700 bg-success-100/70"
                  : "text-danger-700 bg-danger-100/70",
            ].join(" ")}
            title={autoSave.error ?? undefined}
          >
            {autoSave.status === "saving"
              ? "Sauvegarde…"
              : autoSave.status === "saved"
                ? "Sauvegardé"
                : "Erreur de sauvegarde"}
          </span>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-5">
        <PatternTemplateFields
          values={templateValues}
          onChange={handleTemplateFieldsChange}
          builderTemplates={builderTemplates}
          captionPresets={captionPresets}
          descriptionPrompts={descriptionPrompts}
          videoLibraries={videoLibraries}
        />

        {/* Sprint B — Comptes utilisant cette recette (fournis en SSR). */}
        {templateId && (
          <section className="pt-4 mt-5 border-t border-border">
            <CollapsibleSection
              title={`Comptes liés · ${linkedBindings.length}`}
              defaultOpen={false}
              storageKey={`pattern-template:${templateId}:linked`}
            >
              <div className="pt-1">
                {linkedBindings.length === 0 ? (
                  <p className="text-[11.5px] text-muted-foreground">
                    Aucun compte n&apos;utilise cette recette. Applique-la depuis la fiche compte ou via « Appliquer à des comptes ».
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {linkedBindings.map((b) => (
                      <li
                        key={b.id}
                        className="flex items-center justify-between gap-2 rounded-lg bg-card border border-border px-3 py-2 "
                      >
                        <div className="min-w-0">
                          <p className="text-[12.5px] font-medium text-foreground truncate">
                            @{b.account.handle}
                            {b.account.name !== b.account.handle && (
                              <span className="text-muted-foreground font-normal">
                                {" "}
                                · {b.account.name}
                              </span>
                            )}
                          </p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {b.customLabel ?? "Label hérité"} ·{" "}
                            <span className="font-mono">{b.publishTime}</span>
                            {!b.isActive && " · désactivée"}
                          </p>
                        </div>
                        <Link
                          href={`/admin/accounts/${b.account.id}`}
                          className="shrink-0 inline-flex items-center gap-1 text-[11px] text-info-700 hover:text-info-700"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Voir
                          <ExternalLink size={11} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CollapsibleSection>
          </section>
        )}

        {error && <p className="mt-4 text-[12px] text-danger-700">{error}</p>}
      </div>

      {deployOpen && templateId && (
        <DeployTemplateModal
          templateId={templateId}
          templateLabel={templateValues.label || initial?.label || "Recette"}
          onDeployed={() => {
            setDeployOpen(false);
            // Refresh bindings local pour mettre à jour la section "Comptes liés".
            void fetch(`/api/admin/patterns/${templateId}`)
              .then((r) => (r.ok ? r.json() : null))
              .then((data: unknown) => {
                const b = (data as { bindings?: LinkedBinding[] } | null)?.bindings;
                if (b) setLinkedBindings(b);
              })
              .catch(() => {});
          }}
          onClose={() => setDeployOpen(false)}
        />
      )}

      <footer className="shrink-0 flex items-center justify-between gap-2 px-5 py-3 bg-muted border-t border-border">
        {/* Sprint C — bouton "Déployer" + bouton "Archiver" en édition. */}
        <div className="inline-flex items-center gap-2">
          {templateId && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={Rocket}
              onClick={() => setDeployOpen(true)}
            >
              Déployer
            </Button>
          )}
          {onArchive && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={Trash2}
              onClick={() => setConfirmArchive(true)}
            >
              Archiver
            </Button>
          )}
        </div>
        <div className="inline-flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Annuler
          </Button>
          <Button type="submit" variant="primary" size="sm" icon={Sparkles} loading={saving}>
            {templateId ? "Enregistrer" : "Créer la recette"}
          </Button>
        </div>
      </footer>
    </form>
  );
}
