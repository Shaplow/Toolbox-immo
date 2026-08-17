"use client";

/**
 * PatternTemplateForm — formulaire de création/édition d'une recette
 * éditoriale globale (PatternTemplate). 18 champs métier répartis en 3
 * sections (Identité / Production / Workflow) — pas de planning ni
 * d'assignations (qui vivent dans le PatternBinding, par compte).
 */

import { useRecipeEntityBinding } from "@/components/admin/shared/useRecipeEntityBinding";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, Trash2, ExternalLink, Rocket } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { Combobox } from "@/components/ui/Combobox";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { useAutoSave } from "@/hooks/useAutoSave";
import { DeployTemplateModal } from "./DeployTemplateModal";

const SOURCE_OPTIONS = [
  { value: "auto_template", label: "Template auto" },
  { value: "manual_rushes", label: "Montage rushes" },
  { value: "external_upload", label: "Upload externe" },
];

const COVER_MODE_OPTIONS = [
  { value: "none", label: "Pas de cover" },
  { value: "manualSelect", label: "Sélection libre (CM)" },
  { value: "autoPack", label: "Pack auto → sélection (CM)" },
  { value: "monteurUpload", label: "Upload par le monteur" },
];

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
}

export interface PatternTemplateFormValues {
  label: string;
  source: string;
  templateId: string | null;
  captionPresetId: string | null;
  descriptionPromptId: string | null;
  descriptionSourceFieldKey: string | null;
  descriptionFixedText: string | null;
  coverMode: string;
  needsDescription: string;
  needsCaptionsMode: string;
  needsAdminValidation: boolean;
  needsClientValidation: boolean;
  allowsClientRevision: boolean;
  needsBrief: boolean;
  requiresProperty: boolean;
  requiresEntityTypeId: string | null;
  notes: string | null;
  autoSaveToLibraryId: string | null;
}

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

// Fusion captions mode + preset en 1 sélection (cf. P0). Valeurs encodées :
// "none" | "manual" | "auto:<presetId>".
function encodeCaptions(mode: string, presetId: string | null): string {
  if (mode === "auto") return presetId ? `auto:${presetId}` : "auto:";
  return mode || "none";
}
function decodeCaptions(v: string): { mode: string; presetId: string | null } {
  if (v.startsWith("auto:")) {
    const id = v.slice(5);
    return { mode: "auto", presetId: id || null };
  }
  return { mode: v || "none", presetId: null };
}
function encodeDescription(mode: string, promptId: string | null): string {
  if (mode === "autoGenerate") return promptId ? `autoGenerate:${promptId}` : "autoGenerate:";
  return mode || "none";
}
function decodeDescription(v: string): { mode: string; promptId: string | null } {
  if (v.startsWith("autoGenerate:")) {
    const id = v.slice(13);
    return { mode: "autoGenerate", promptId: id || null };
  }
  return { mode: v || "none", promptId: null };
}

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
  const [label, setLabel] = useState(initial?.label ?? "");
  const [source, setSource] = useState(initial?.source ?? "manual_rushes");
  const [builderTemplateId, setBuilderTemplateId] = useState<string>(initial?.templateId ?? "");
  const [coverMode, setCoverMode] = useState(initial?.coverMode ?? "none");
  const [needsCaptionsMode, setNeedsCaptionsMode] = useState(initial?.needsCaptionsMode ?? "none");
  const [captionPresetId, setCaptionPresetId] = useState<string>(initial?.captionPresetId ?? "");
  const [needsDescription, setNeedsDescription] = useState(initial?.needsDescription ?? "none");
  const [descriptionPromptId, setDescriptionPromptId] = useState<string>(
    initial?.descriptionPromptId ?? "",
  );
  const [descriptionSourceFieldKey, setDescriptionSourceFieldKey] = useState<string>(
    initial?.descriptionSourceFieldKey ?? "",
  );
  const [descriptionFixedText, setDescriptionFixedText] = useState<string>(
    initial?.descriptionFixedText ?? "",
  );
  // Socle partagé RecipeForm/PatternTemplateForm (V2.6) : « Exige une
  // fiche » + types de fiche + clés de champ suggérées (mode preFilled).
  const { requiresEntityTypeId, setRequiresEntityTypeId, entityTypes, propertyFieldKeys } =
    useRecipeEntityBinding({
      initialRequiresEntityTypeId: initial?.requiresEntityTypeId,
      initialRequiresProperty: initial?.requiresProperty,
      needsDescription,
    });
  const [needsAdminValidation, setNeedsAdminValidation] = useState(
    initial?.needsAdminValidation ?? false,
  );
  const [needsClientValidation, setNeedsClientValidation] = useState(
    initial?.needsClientValidation ?? false,
  );
  const [allowsClientRevision, setAllowsClientRevision] = useState(
    initial?.allowsClientRevision ?? false,
  );
  const [needsBrief, setNeedsBrief] = useState(initial?.needsBrief ?? false);
  const [notes, setNotes] = useState<string>(initial?.notes ?? "");
  // Missions — bibliothèque vidéo cible pour l'auto-save. "" = null (désactivé).
  const [autoSaveLibraryId, setAutoSaveLibraryId] = useState<string>(
    initial?.autoSaveToLibraryId ?? "",
  );
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Sprint D — confirmation impact avant save quand la recette est utilisée
  // et qu'on touche à un champ structurant.
  const [pendingValues, setPendingValues] =
    useState<PatternTemplateFormValues | null>(null);
  // Sprint C — modal "Déployer cette recette à N comptes".
  const [deployOpen, setDeployOpen] = useState(false);
  // Sprint B — bindings liés à la recette (chargés en lazy-load).
  const [linkedBindings, setLinkedBindings] = useState<LinkedBinding[] | null>(
    null,
  );
  const [linkedLoading, setLinkedLoading] = useState(false);
  // Sprint D — auteur de la dernière modification (audit log light).
  const [updatedBy, setUpdatedBy] = useState<{
    name: string;
    at: string;
  } | null>(null);

  // Phase 10 V2 — auto-save sur les champs SAFE en mode édition :
  //   - label, notes, workflow toggles (needsBrief, needsAdminValidation,
  //     needsClientValidation, allowsClientRevision).
  // Les champs structurants (source, templateId, presets, coverMode,
  // captionsMode, descriptionMode) restent en save manuel + ConfirmDialog
  // d'impact (le diff structurant est ce qui propage aux futurs slots).
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

  function setLabelWithAutoSave(v: string) {
    setLabel(v);
    // On enqueue toujours en édition, même si v est vide : le serveur valide
    // (label trim() requis côté PATCH) et le statut auto-save passe à "error"
    // ce qui rend l'invalidité visible pour l'admin. Filtrer côté front (sur
    // v.trim() non vide) masque l'erreur et laisse l'ancien label en DB sans
    // signal — confusion garantie.
    if (templateId) autoSave.enqueue({ label: v.trim() });
  }
  function setNotesWithAutoSave(v: string) {
    setNotes(v);
    if (templateId) autoSave.enqueue({ notes: v.trim() || null });
  }
  function setNeedsBriefWithAutoSave(v: boolean) {
    setNeedsBrief(v);
    if (templateId) autoSave.enqueue({ needsBrief: v });
  }
  function setRequiresEntityTypeIdWithAutoSave(v: string) {
    setRequiresEntityTypeId(v);
    if (templateId) {
      autoSave.enqueue({ requiresProperty: !!v, requiresEntityTypeId: v || null });
    }
  }
  function setNeedsAdminValidationWithAutoSave(v: boolean) {
    setNeedsAdminValidation(v);
    if (templateId) autoSave.enqueue({ needsAdminValidation: v });
  }
  function setNeedsClientValidationWithAutoSave(v: boolean) {
    setNeedsClientValidation(v);
    if (templateId) {
      // Désactiver needsClientValidation cascade aussi allowsClientRevision
      // (le serveur n'impose pas la contrainte mais on garde la cohérence
      // d'état pour ne pas afficher « ping-pong » sur une recette sans
      // validation client).
      if (!v && allowsClientRevision) {
        setAllowsClientRevision(false);
        autoSave.enqueue({
          needsClientValidation: v,
          allowsClientRevision: false,
        });
      } else {
        autoSave.enqueue({ needsClientValidation: v });
      }
    }
  }
  function setAllowsClientRevisionWithAutoSave(v: boolean) {
    setAllowsClientRevision(v);
    if (templateId) autoSave.enqueue({ allowsClientRevision: v });
  }

  useEffect(() => {
    if (!templateId) return;
    let cancelled = false;
    void (async () => {
      setLinkedLoading(true);
      try {
        const r = await fetch(`/api/admin/patterns/${templateId}`);
        const data = r.ok ? ((await r.json()) as unknown) : null;
        if (cancelled || !data) return;
        const d = data as {
          templateId?: string | null;
          captionPresetId?: string | null;
          descriptionPromptId?: string | null;
          descriptionSourceFieldKey?: string | null;
          descriptionFixedText?: string | null;
          autoSaveToLibraryId?: string | null;
          bindings?: LinkedBinding[];
          updatedBy?: { name: string | null } | null;
          updatedAt?: string;
        };
        // Bug A.1 — `initial.templateId / captionPresetId / descriptionPromptId`
        // sont passés à `null` depuis le catalogue (les rows ne portent que les
        // *Name). On hydrate ici depuis la route détail pour éviter de perdre
        // les sélections en mode édition.
        if (d.templateId !== undefined) setBuilderTemplateId(d.templateId ?? "");
        if (d.captionPresetId !== undefined)
          setCaptionPresetId(d.captionPresetId ?? "");
        if (d.descriptionPromptId !== undefined)
          setDescriptionPromptId(d.descriptionPromptId ?? "");
        if (d.descriptionSourceFieldKey !== undefined)
          setDescriptionSourceFieldKey(d.descriptionSourceFieldKey ?? "");
        if (d.descriptionFixedText !== undefined)
          setDescriptionFixedText(d.descriptionFixedText ?? "");
        if (d.autoSaveToLibraryId !== undefined)
          setAutoSaveLibraryId(d.autoSaveToLibraryId ?? "");
        setLinkedBindings(d.bindings ?? []);
        if (d.updatedBy?.name && d.updatedAt) {
          setUpdatedBy({ name: d.updatedBy.name, at: d.updatedAt });
        }
      } catch {
        if (!cancelled) setLinkedBindings([]);
      } finally {
        if (!cancelled) setLinkedLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Flush les éventuels SAFE patches en attente avant un save manuel — sinon
    // le PATCH structurant pourrait écraser un toggle workflow encore dans la
    // fenêtre de debounce auto-save.
    if (templateId) await autoSave.flush();
    if (!label.trim()) {
      setError("Le label est requis.");
      return;
    }
    if (source === "auto_template" && !builderTemplateId) {
      setError("La source « Template auto » nécessite un template builder.");
      return;
    }
    if (needsCaptionsMode === "auto" && !captionPresetId) {
      setError("Le mode captions auto nécessite un preset.");
      return;
    }
    if (needsDescription === "autoGenerate" && !descriptionPromptId) {
      setError("La description auto nécessite un prompt IA.");
      return;
    }
    if (allowsClientRevision && !needsClientValidation) {
      setError("« Autoriser révisions client » nécessite « Validation client » activée.");
      return;
    }
    const values: PatternTemplateFormValues = {
      label: label.trim(),
      source,
      templateId: builderTemplateId || null,
      captionPresetId: needsCaptionsMode === "auto" ? captionPresetId || null : null,
      descriptionPromptId:
        needsDescription === "autoGenerate" ? descriptionPromptId || null : null,
      descriptionSourceFieldKey:
        needsDescription === "preFilled" ? descriptionSourceFieldKey.trim() || null : null,
      descriptionFixedText:
        needsDescription === "fixed" ? descriptionFixedText.trim() || null : null,
      coverMode,
      needsDescription,
      needsCaptionsMode,
      needsAdminValidation,
      needsClientValidation,
      allowsClientRevision: needsClientValidation && allowsClientRevision,
      needsBrief,
      requiresProperty: !!requiresEntityTypeId,
      requiresEntityTypeId: requiresEntityTypeId || null,
      notes: notes.trim() || null,
      autoSaveToLibraryId: autoSaveLibraryId || null,
    };

    // Sprint D — Si la recette est utilisée par au moins 1 binding et que
    // le diff touche un champ structurant (source, builderTemplate, presets,
    // coverMode, captions/description mode), demande confirmation explicite
    // avant de propager la modif (les futurs slots auto en hériteront).
    const bindingCount = initial?.bindingCount ?? 0;
    const isStructuralChange =
      templateId !== null &&
      initial !== null &&
      (initial.source !== values.source ||
        initial.templateId !== values.templateId ||
        initial.captionPresetId !== values.captionPresetId ||
        initial.descriptionPromptId !== values.descriptionPromptId ||
        initial.coverMode !== values.coverMode ||
        initial.needsCaptionsMode !== values.needsCaptionsMode ||
        initial.needsDescription !== values.needsDescription ||
        (initial.descriptionSourceFieldKey ?? null) !== values.descriptionSourceFieldKey ||
        (initial.descriptionFixedText ?? null) !== values.descriptionFixedText ||
        (initial.autoSaveToLibraryId ?? null) !== values.autoSaveToLibraryId);
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
          {templateId ? label || "Sans nom" : "Nouvelle recette"}
        </h2>
        {initial?.bindingCount !== undefined && initial.bindingCount > 0 && (
          <p className="mt-1 text-[11.5px] text-info-700">
            Utilisée par {initial.bindingCount} compte
            {initial.bindingCount > 1 ? "s" : ""}.
          </p>
        )}
        {/* Sprint D — Auteur de la dernière modification (lazy-load). */}
        {updatedBy && (
          <p className="mt-1 text-[10.5px] text-muted-foreground">
            Modifiée par {updatedBy.name} ·{" "}
            {new Date(updatedBy.at).toLocaleDateString("fr-FR", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
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

      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
        {/* Identité */}
        <section className="space-y-3">
          <h3 className="text-[10px] uppercase tracking-widest font-semibold text-foreground">
            Identité
          </h3>
          <FormField label="Label" required>
            <Input
              value={label}
              onChange={setLabelWithAutoSave}
              placeholder="Ex. RPI Lundi 9h"
            />
          </FormField>
          <FormField label="Source" required>
            <Combobox value={source} onChange={setSource} options={SOURCE_OPTIONS} />
          </FormField>
          {source === "auto_template" && (
            <FormField label="Template builder" required>
              <Combobox
                value={builderTemplateId}
                onChange={setBuilderTemplateId}
                options={[
                  { value: "", label: "— Choisir —" },
                  ...builderTemplates.map((t) => ({ value: t.id, label: t.name })),
                ]}
              />
            </FormField>
          )}
        </section>

        {/* Production */}
        <section className="space-y-3 pt-4 border-t border-border">
          <h3 className="text-[10px] uppercase tracking-widest font-semibold text-foreground">
            Production
          </h3>
          <FormField label="Cover">
            <Combobox value={coverMode} onChange={setCoverMode} options={COVER_MODE_OPTIONS} />
          </FormField>
          <FormField label="Sous-titres">
            <Combobox
              value={encodeCaptions(needsCaptionsMode, captionPresetId)}
              onChange={(v) => {
                const { mode, presetId } = decodeCaptions(v);
                setNeedsCaptionsMode(mode);
                setCaptionPresetId(presetId ?? "");
              }}
              options={[
                { value: "none", label: "Aucun" },
                ...captionPresets.map((p) => ({
                  value: `auto:${p.id}`,
                  label: `Auto · ${p.name}`,
                })),
                { value: "manual", label: "Manuel" },
              ]}
            />
          </FormField>
          <FormField label="Description Instagram">
            <Combobox
              value={encodeDescription(needsDescription, descriptionPromptId)}
              onChange={(v) => {
                const { mode, promptId } = decodeDescription(v);
                setNeedsDescription(mode);
                setDescriptionPromptId(promptId ?? "");
              }}
              options={[
                { value: "none", label: "Aucune" },
                { value: "preFilled", label: "Pré-remplie par bien" },
                { value: "fixed", label: "Texte fixe" },
                ...descriptionPrompts.map((p) => ({
                  value: `autoGenerate:${p.id}`,
                  label: `Auto IA · ${p.name}`,
                })),
                { value: "manualWrite", label: "Manuelle" },
              ]}
            />
          </FormField>
          {needsDescription === "preFilled" && (
            <FormField
              label="Champ du bien qui pré-remplit la légende"
              help="La légende démarre avec la valeur de ce champ du bien rattaché. Écrasée à chaque changement de bien."
            >
              <Combobox
                value={descriptionSourceFieldKey}
                onChange={setDescriptionSourceFieldKey}
                allowCustom
                placeholder="ex : description"
                options={propertyFieldKeys.map((f) => ({
                  value: f.key,
                  label: f.label === f.key ? f.key : `${f.label} · ${f.key}`,
                }))}
              />
            </FormField>
          )}
          {needsDescription === "fixed" && (
            <FormField
              label="Texte pré-rempli (fixe)"
              help="Pré-remplit la légende à la création, indépendamment du bien. Le CM peut l'ajuster ensuite."
            >
              <Textarea
                value={descriptionFixedText}
                onChange={(v) => setDescriptionFixedText(v)}
                rows={5}
                placeholder="Texte de légende par défaut…"
              />
            </FormField>
          )}
          <FormField
            label="Exige une fiche"
            help="Une fiche de ce type doit être rattachée pour créer un slot ou une mission depuis cette recette."
          >
            <Combobox
              value={requiresEntityTypeId}
              onChange={setRequiresEntityTypeIdWithAutoSave}
              options={[
                { value: "", label: "Aucune" },
                ...entityTypes.map((t) => ({ value: t.id, label: t.name })),
              ]}
            />
          </FormField>
        </section>

        {/* Workflow */}
        <section className="space-y-2 pt-4 border-t border-border">
          <h3 className="text-[10px] uppercase tracking-widest font-semibold text-foreground">
            Workflow
          </h3>
          <WorkflowToggle
            label="Brief éditorial"
            description="Champ Brief à remplir avant production."
            checked={needsBrief}
            onChange={setNeedsBriefWithAutoSave}
          />
          <WorkflowToggle
            label="Validation admin du montage"
            description="Le montage passe par « À valider » avant publication."
            checked={needsAdminValidation}
            onChange={setNeedsAdminValidationWithAutoSave}
          />
          <WorkflowToggle
            label="Validation client (magic link)"
            description="Lien de validation envoyé au client avant publication."
            checked={needsClientValidation}
            onChange={setNeedsClientValidationWithAutoSave}
          />
          {needsClientValidation && (
            <div className="ml-3 pl-3 border-l-2 border-danger-200/60">
              <WorkflowToggle
                label="Autoriser révisions client"
                description="Le client peut refuser avec un commentaire."
                checked={allowsClientRevision}
                onChange={setAllowsClientRevisionWithAutoSave}
              />
            </div>
          )}
        </section>

        {/* Missions */}
        <section className="space-y-3 pt-4 border-t border-border">
          <h3 className="text-[10px] uppercase tracking-widest font-semibold text-foreground">
            Missions
          </h3>
          <FormField
            label="Auto-save sortie vers bibliothèque"
            help="La sortie de génération est copiée automatiquement en tant que média vidéo."
          >
            <Combobox
              value={autoSaveLibraryId}
              onChange={setAutoSaveLibraryId}
              options={[
                { value: "", label: "Aucune (désactivé)" },
                ...videoLibraries.map((lib) => ({ value: lib.id, label: lib.name })),
              ]}
            />
          </FormField>
        </section>

        {/* Notes */}
        <section className="pt-4 border-t border-border">
          <FormField label="Notes internes">
            <Textarea
              value={notes}
              onChange={setNotesWithAutoSave}
              rows={3}
              placeholder="Contexte, conventions de naming, instructions équipe…"
            />
          </FormField>
        </section>

        {/* Sprint B — Comptes utilisant cette recette (lazy-loaded). */}
        {templateId && (
          <section className="pt-4 border-t border-border">
            <CollapsibleSection
              title={`Comptes liés${linkedBindings ? ` · ${linkedBindings.length}` : ""}`}
              defaultOpen={false}
              storageKey={`pattern-template:${templateId}:linked`}
            >
              <div className="pt-1">
                {linkedLoading ? (
                  <p className="text-[11.5px] text-muted-foreground">Chargement…</p>
                ) : !linkedBindings || linkedBindings.length === 0 ? (
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

        {error && <p className="text-[12px] text-danger-700">{error}</p>}
      </div>

      {deployOpen && templateId && (
        <DeployTemplateModal
          templateId={templateId}
          templateLabel={label || initial?.label || "Recette"}
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

function WorkflowToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-white/40 transition-colors cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-border text-info-600 focus:ring-info-600"
      />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-gray-900">{label}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>
      </div>
    </label>
  );
}
