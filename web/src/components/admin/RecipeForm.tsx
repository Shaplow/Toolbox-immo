"use client";

/**
 * RecipeForm — formulaire unifié pour créer/éditer une recette appliquée à
 * un compte.
 *
 * G.3 — Remplace PatternBindingForm. Fusionne PatternTemplate (contenu) +
 * PatternBinding (planning, équipe, overrides) dans un seul drawer avec
 * tabs. L'admin ne voit plus la distinction technique : il édite « sa
 * recette » et l'API atomique /recipes save les deux côtés ensemble.
 *
 * Tabs :
 *   1. Contenu       — champs du PatternTemplate (recette globale), portés
 *                       par <PatternTemplateFields> (partagé avec
 *                       PatternTemplateForm — même champs, même validation).
 *   2. Planning      — horaires + jours + équipe par défaut + actif
 *   3. Spécifique    — overrides ponctuels (rare ; replié par défaut)
 *
 * Si la recette est partagée avec d'autres comptes (sharedWithCount > 1), un
 * banner d'avertissement dans Contenu rappelle que les modifs s'appliquent
 * partout.
 */

import { useState } from "react";
import { Save, Trash2, AlertTriangle, Sparkles, CalendarDays, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Tabs } from "@/components/ui/Tabs";
import { Textarea } from "@/components/ui/Textarea";
import {
  BindingScheduleFields,
  type BindingScheduleValues,
} from "@/components/admin/shared/BindingScheduleFields";
import {
  PatternTemplateFields,
  decodePatternTemplateFields,
  encodePatternTemplateFieldsPayload,
  validateRecipeTemplate,
  type PatternTemplateFieldValues,
  type PatternTemplateFieldsPayload,
} from "@/components/admin/shared/PatternTemplateFields";
import { coverModeOverrideOptions } from "@/lib/i18n/glossary";

export interface RecipeFormInitial {
  // Template
  label: string;
  source: string;
  templateId: string | null;
  coverMode: string;
  needsCaptionsMode: string;
  needsDescription: string;
  needsAdminValidation: boolean;
  needsClientValidation: boolean;
  allowsClientRevision: boolean;
  needsBrief: boolean;
  requiresProperty: boolean;
  /** Phase 5 (métaobjet) — remplace requiresProperty. */
  requiresEntityTypeId: string | null;
  captionPresetId: string | null;
  descriptionPromptId: string | null;
  descriptionSourceFieldKey: string | null;
  descriptionFixedText: string | null;
  /** Mode preFilled : bibliothèque dont une fiche est tirée pour la légende. */
  descriptionDataLibraryId: string | null;
  /** Dossier épinglé dans cette bibliothèque. null = tous les dossiers. */
  descriptionDataSetTag: string | null;
  /** V2.6 — auto-save de la sortie de génération vers une MediaLibrary vidéo. */
  autoSaveToLibraryId: string | null;
  templateNotes: string | null;
  // Binding
  customLabel: string | null;
  dayOfWeek: number[];
  publishTime: string;
  isActive: boolean;
  defaultAssigneeMonteurId: string | null;
  defaultAssigneeCmId: string | null;
  defaultAssigneeVideasteId: string | null;
  captionPresetIdOverride: string | null;
  descriptionPromptIdOverride: string | null;
  coverModeOverride: string | null;
  bindingNotes: string | null;
  sharedWithCount: number;
}

export interface RecipeFormValues {
  template: PatternTemplateFieldsPayload;
  binding: {
    customLabel: string | null;
    dayOfWeek: number[];
    publishTime: string;
    isActive: boolean;
    defaultAssigneeMonteurId: string | null;
    defaultAssigneeCmId: string | null;
    defaultAssigneeVideasteId: string | null;
    captionPresetIdOverride: string | null;
    descriptionPromptIdOverride: string | null;
    coverModeOverride: string | null;
    notes: string | null;
  };
}

interface Props {
  isCreating: boolean;
  /** Si fourni : reuse mode (catalog template). Pas d'édition template. */
  reusedTemplateId?: string;
  initial: RecipeFormInitial;
  monteurs: { id: string; name: string }[];
  cms: { id: string; name: string }[];
  videastes: { id: string; name: string }[];
  builderTemplates: { id: string; name: string }[];
  captionPresets: { id: string; name: string }[];
  descriptionPrompts: { id: string; name: string }[];
  /** Bibliothèques vidéo pour l'auto-save de sortie (V2.6). */
  videoLibraries: { id: string; name: string }[];
  saving: boolean;
  onSave: (values: RecipeFormValues) => Promise<void> | void;
  onDelete?: () => void;
  onClose: () => void;
}

export function RecipeForm({
  isCreating,
  reusedTemplateId,
  initial,
  monteurs,
  cms,
  videastes,
  builderTemplates,
  captionPresets,
  descriptionPrompts,
  videoLibraries,
  saving,
  onSave,
  onDelete,
  onClose,
}: Props) {
  // Reuse mode = on applique une recette existante. Pas d'édition template.
  const reuseMode = !!reusedTemplateId;
  const sharedWarning = !isCreating && !reuseMode && initial.sharedWithCount > 1;

  const [tab, setTab] = useState<"content" | "planning" | "advanced">("content");

  // Template state — champs partagés avec PatternTemplateForm.
  const [templateValues, setTemplateValues] = useState<PatternTemplateFieldValues>(() =>
    decodePatternTemplateFields({
      label: initial.label,
      source: initial.source,
      templateId: initial.templateId,
      coverMode: initial.coverMode,
      needsCaptionsMode: initial.needsCaptionsMode,
      captionPresetId: initial.captionPresetId,
      needsDescription: initial.needsDescription,
      descriptionPromptId: initial.descriptionPromptId,
      descriptionSourceFieldKey: initial.descriptionSourceFieldKey,
      descriptionFixedText: initial.descriptionFixedText,
      descriptionDataLibraryId: initial.descriptionDataLibraryId,
      descriptionDataSetTag: initial.descriptionDataSetTag,
      requiresEntityTypeId: initial.requiresEntityTypeId,
      requiresProperty: initial.requiresProperty,
      needsAdminValidation: initial.needsAdminValidation,
      needsClientValidation: initial.needsClientValidation,
      allowsClientRevision: initial.allowsClientRevision,
      needsBrief: initial.needsBrief,
      autoSaveToLibraryId: initial.autoSaveToLibraryId,
      notes: initial.templateNotes,
    }),
  );
  function updateTemplateValues(patch: Partial<PatternTemplateFieldValues>) {
    setTemplateValues((prev) => ({ ...prev, ...patch }));
  }

  // Binding state
  const [customLabel, setCustomLabel] = useState(initial.customLabel ?? "");
  const [schedule, setSchedule] = useState<BindingScheduleValues>({
    publishTime: initial.publishTime,
    dayOfWeek: isCreating && initial.dayOfWeek.length === 0 ? [1, 2, 3, 4, 5] : initial.dayOfWeek,
    monteurId: initial.defaultAssigneeMonteurId ?? "",
    cmId: initial.defaultAssigneeCmId ?? "",
    videasteId: initial.defaultAssigneeVideasteId ?? "",
  });
  function updateSchedule(patch: Partial<BindingScheduleValues>) {
    setSchedule((prev) => ({ ...prev, ...patch }));
  }
  const [isActive, setIsActive] = useState(initial.isActive);
  const [captionPresetOverride, setCaptionPresetOverride] = useState(
    initial.captionPresetIdOverride ?? "",
  );
  const [descriptionPromptOverride, setDescriptionPromptOverride] = useState(
    initial.descriptionPromptIdOverride ?? "",
  );
  const [coverModeOverride, setCoverModeOverride] = useState(initial.coverModeOverride ?? "");
  const [bindingNotes, setBindingNotes] = useState(initial.bindingNotes ?? "");

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!reuseMode) {
      const templateError = validateRecipeTemplate(templateValues);
      if (templateError) {
        setError(templateError);
        setTab("content");
        return;
      }
    }
    if (!schedule.publishTime) {
      setError("L'heure de publication est requise.");
      setTab("planning");
      return;
    }
    void onSave({
      template: encodePatternTemplateFieldsPayload(templateValues),
      binding: {
        customLabel: customLabel.trim() || null,
        dayOfWeek: schedule.dayOfWeek,
        publishTime: schedule.publishTime,
        isActive,
        defaultAssigneeMonteurId: schedule.monteurId || null,
        defaultAssigneeCmId: schedule.cmId || null,
        defaultAssigneeVideasteId: schedule.videasteId || null,
        captionPresetIdOverride: captionPresetOverride || null,
        descriptionPromptIdOverride: descriptionPromptOverride || null,
        coverModeOverride: coverModeOverride || null,
        notes: bindingNotes.trim() || null,
      },
    });
  }

  const headerTitle = customLabel.trim() || templateValues.label.trim() || "Nouvelle recette";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-full">
      <ConfirmDialog
        open={confirmDelete}
        title="Retirer cette recette du compte ?"
        description="La recette globale reste dans le catalogue. Seule l'application à ce compte est supprimée."
        confirmLabel="Retirer"
        variant="danger"
        loading={saving}
        onConfirm={() => {
          setConfirmDelete(false);
          if (onDelete) onDelete();
        }}
        onCancel={() => setConfirmDelete(false)}
      />

      <header className="shrink-0 px-5 pt-5 pb-3 border-b border-border">
        <h2 className="text-[18px] font-semibold tracking-tight text-foreground truncate">
          {headerTitle}
        </h2>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          {isCreating
            ? "Configure le contenu, le planning et l'équipe."
            : reuseMode
              ? "Édite le planning et l'équipe pour ce compte."
              : "Édite le contenu, le planning et l'équipe."}
        </p>
      </header>

      <div className="shrink-0 px-5 pt-3">
        <Tabs
          variant="line"
          value={tab}
          onChange={(id) => setTab(id as typeof tab)}
          items={[
            { id: "content", label: "Contenu", icon: Sparkles, disabled: reuseMode },
            { id: "planning", label: "Planning & équipe", icon: CalendarDays },
            { id: "advanced", label: "Spécifique", icon: SlidersHorizontal },
          ]}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
        {tab === "content" &&
          (reuseMode ? (
            <p className="text-[12px] text-muted-foreground">
              Recette importée du catalogue — son contenu reste géré globalement.
              Pour modifier le contenu, va sur /admin/patterns.
            </p>
          ) : (
            <div className="space-y-4">
              {sharedWarning && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-warning-50 border border-warning-200 text-warning-700 text-[12px]">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  <span>
                    Recette utilisée par {initial.sharedWithCount} comptes. Les modifications
                    de contenu s&apos;appliquent partout.
                  </span>
                </div>
              )}
              <PatternTemplateFields
                values={templateValues}
                onChange={updateTemplateValues}
                builderTemplates={builderTemplates}
                captionPresets={captionPresets}
                descriptionPrompts={descriptionPrompts}
                videoLibraries={videoLibraries}
              />
            </div>
          ))}

        {tab === "planning" && (
          <div className="space-y-4">
            <FormField
              label="Nom affiché pour ce compte"
              help="Vide = hérite du nom global de la recette."
            >
              <Input
                value={customLabel}
                onChange={setCustomLabel}
                placeholder={templateValues.label || "Recette"}
              />
            </FormField>

            <BindingScheduleFields
              values={schedule}
              onChange={updateSchedule}
              monteurs={monteurs}
              cms={cms}
              videastes={videastes}
              dayOfWeekHelp={
                schedule.dayOfWeek.length === 0
                  ? "Aucun jour sélectionné : aucune génération auto, slots créés à la main."
                  : undefined
              }
            />

            <label className="flex items-center gap-3 p-2.5 rounded-md hover:bg-muted/40 cursor-pointer">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              <span className="text-[13px] text-foreground">
                Recette active (sinon le cron ignore la génération auto)
              </span>
            </label>
          </div>
        )}

        {tab === "advanced" && (
          <div className="space-y-4">
            <p className="text-[12px] text-muted-foreground">
              Dévie la recette pour ce compte uniquement. La majorité des comptes laissent ces champs hérités.
            </p>
            <FormField label="Preset captions (override)">
              <Combobox
                value={captionPresetOverride}
                onChange={setCaptionPresetOverride}
                options={[
                  { value: "", label: "Hérite de la recette" },
                  ...captionPresets.map((cp) => ({ value: cp.id, label: cp.name })),
                ]}
              />
            </FormField>
            <FormField label="Prompt description (override)">
              <Combobox
                value={descriptionPromptOverride}
                onChange={setDescriptionPromptOverride}
                options={[
                  { value: "", label: "Hérite de la recette" },
                  ...descriptionPrompts.map((dp) => ({ value: dp.id, label: dp.name })),
                ]}
              />
            </FormField>
            <FormField label="Mode cover (override)">
              <Combobox
                value={coverModeOverride}
                onChange={setCoverModeOverride}
                options={coverModeOverrideOptions()}
              />
            </FormField>
            <FormField label="Notes de l'application (privées)">
              <Textarea value={bindingNotes} onChange={setBindingNotes} rows={2} />
            </FormField>
          </div>
        )}

        {error && <p className="text-[12px] text-danger-700">{error}</p>}
      </div>

      <footer className="shrink-0 flex items-center justify-between gap-2 px-5 py-3 border-t border-border bg-card">
        {onDelete ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon={Trash2}
            onClick={() => setConfirmDelete(true)}
          >
            Retirer la recette
          </Button>
        ) : (
          <span />
        )}
        <div className="inline-flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Annuler
          </Button>
          <Button type="submit" variant="primary" size="sm" icon={Save} loading={saving}>
            {isCreating ? "Créer la recette" : "Enregistrer"}
          </Button>
        </div>
      </footer>
    </form>
  );
}
