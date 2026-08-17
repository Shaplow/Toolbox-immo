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
 *   1. Contenu       — champs du PatternTemplate (recette globale)
 *   2. Planning      — horaires + jours + équipe par défaut + actif
 *   3. Spécifique    — overrides ponctuels (rare ; replié par défaut)
 *
 * Si la recette est partagée avec d'autres comptes (sharedWithCount > 1), un
 * banner d'avertissement dans Contenu rappelle que les modifs s'appliquent
 * partout.
 */

import { useEffect, useState } from "react";
import { Save, Trash2, AlertTriangle, Sparkles, CalendarDays, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Tabs } from "@/components/ui/Tabs";
import { Textarea } from "@/components/ui/Textarea";
import { TimePicker } from "@/components/ui/TimePicker";
import {
  CAPTIONS_MODE_LABELS_FR,
  COVER_MODE_LABELS_FR,
  NEEDS_DESCRIPTION_LABELS_FR,
  SOURCE_HELP,
  SOURCE_LABELS_FR,
} from "@/lib/i18n/entityLabels";

const DAYS = [
  { value: 1, label: "Lun" },
  { value: 2, label: "Mar" },
  { value: 3, label: "Mer" },
  { value: 4, label: "Jeu" },
  { value: 5, label: "Ven" },
  { value: 6, label: "Sam" },
  { value: 7, label: "Dim" },
];

const SOURCE_OPTIONS = ["auto_template", "manual_rushes", "external_upload"];
const CAPTIONS_MODE_OPTIONS = ["none", "auto", "manual"];
const DESCRIPTION_MODE_OPTIONS = ["none", "manualWrite", "preFilled", "fixed", "autoGenerate"];
const COVER_MODE_OPTIONS = ["none", "manualSelect", "autoPack", "monteurUpload"];

const COVER_OVERRIDE_OPTIONS = [
  { value: "", label: "Hérite de la recette" },
  { value: "none", label: "Pas de cover" },
  { value: "manualSelect", label: "Sélection libre (CM)" },
  { value: "autoPack", label: "Pack auto → sélection" },
  { value: "monteurUpload", label: "Upload par le monteur" },
];

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
  template: {
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
    requiresEntityTypeId: string | null;
    captionPresetId: string | null;
    descriptionPromptId: string | null;
    descriptionSourceFieldKey: string | null;
    descriptionFixedText: string | null;
    notes: string | null;
  };
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
  saving,
  onSave,
  onDelete,
  onClose,
}: Props) {
  // Reuse mode = on applique une recette existante. Pas d'édition template.
  const reuseMode = !!reusedTemplateId;
  const sharedWarning = !isCreating && !reuseMode && initial.sharedWithCount > 1;

  const [tab, setTab] = useState<"content" | "planning" | "advanced">("content");

  // Template state
  const [label, setLabel] = useState(initial.label);
  const [source, setSource] = useState(initial.source);
  const [templateId, setTemplateId] = useState(initial.templateId ?? "");
  const [coverMode, setCoverMode] = useState(initial.coverMode);
  const [needsCaptionsMode, setNeedsCaptionsMode] = useState(initial.needsCaptionsMode);
  const [needsDescription, setNeedsDescription] = useState(initial.needsDescription);
  const [needsAdminValidation, setNeedsAdminValidation] = useState(initial.needsAdminValidation);
  const [needsClientValidation, setNeedsClientValidation] = useState(initial.needsClientValidation);
  const [allowsClientRevision, setAllowsClientRevision] = useState(initial.allowsClientRevision);
  const [needsBrief, setNeedsBrief] = useState(initial.needsBrief);
  // Phase 5 (métaobjet) — « Exige une fiche » : select de type au lieu d'un
  // toggle booléen. Compat : requiresProperty=true sans requiresEntityTypeId
  // (recette pas encore migrée) affiche « Bien » sélectionné.
  const [requiresEntityTypeId, setRequiresEntityTypeId] = useState(
    initial.requiresEntityTypeId ?? (initial.requiresProperty ? "etype_bien" : ""),
  );
  const [entityTypes, setEntityTypes] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch("/api/entity-types");
        if (!r.ok) return;
        const data = (await r.json()) as { types: { id: string; name: string }[] };
        if (!cancelled) setEntityTypes(data.types);
      } catch {
        /* liste indisponible — le select reste vide */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const [captionPresetId, setCaptionPresetId] = useState(initial.captionPresetId ?? "");
  const [descriptionPromptId, setDescriptionPromptId] = useState(initial.descriptionPromptId ?? "");
  const [descriptionSourceFieldKey, setDescriptionSourceFieldKey] = useState(
    initial.descriptionSourceFieldKey ?? "",
  );
  const [descriptionFixedText, setDescriptionFixedText] = useState(
    initial.descriptionFixedText ?? "",
  );
  // Clés de champs de fiche suggérées (mode preFilled) — chargées à la volée
  // depuis le type de fiche sélectionné (fallback « Bien » si aucun type
  // requis), saisie libre autorisée (la fiche peut ne pas exister encore).
  const [propertyFieldKeys, setPropertyFieldKeys] = useState<{ key: string; label: string }[]>([]);
  const fieldKeysTypeId = requiresEntityTypeId || "etype_bien";
  useEffect(() => {
    if (needsDescription !== "preFilled") return;
    let cancelled = false;
    void (async () => {
      setPropertyFieldKeys([]);
      try {
        const r = await fetch(`/api/entity-types/${fieldKeysTypeId}/field-keys`);
        if (!r.ok) return;
        const data = (await r.json()) as { key: string; label: string }[];
        if (!cancelled) setPropertyFieldKeys(data);
      } catch {
        /* suggestions indisponibles — saisie libre */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [needsDescription, fieldKeysTypeId]);
  const [templateNotes, setTemplateNotes] = useState(initial.templateNotes ?? "");

  // Binding state
  const [customLabel, setCustomLabel] = useState(initial.customLabel ?? "");
  const [publishTime, setPublishTime] = useState(initial.publishTime);
  const [dayOfWeek, setDayOfWeek] = useState<number[]>(
    isCreating && initial.dayOfWeek.length === 0 ? [1, 2, 3, 4, 5] : initial.dayOfWeek,
  );
  const [isActive, setIsActive] = useState(initial.isActive);
  const [monteurId, setMonteurId] = useState(initial.defaultAssigneeMonteurId ?? "");
  const [cmId, setCmId] = useState(initial.defaultAssigneeCmId ?? "");
  const [videasteId, setVideasteId] = useState(initial.defaultAssigneeVideasteId ?? "");
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

  function toggleDay(d: number) {
    setDayOfWeek((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort(),
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!reuseMode && !label.trim()) {
      setError("Le nom de la recette est requis.");
      setTab("content");
      return;
    }
    if (!publishTime) {
      setError("L'heure de publication est requise.");
      setTab("planning");
      return;
    }
    void onSave({
      template: {
        label: label.trim(),
        source,
        templateId: templateId || null,
        coverMode,
        needsCaptionsMode,
        needsDescription,
        needsAdminValidation,
        needsClientValidation,
        allowsClientRevision,
        needsBrief,
        requiresProperty: !!requiresEntityTypeId,
        requiresEntityTypeId: requiresEntityTypeId || null,
        captionPresetId: captionPresetId || null,
        descriptionPromptId: descriptionPromptId || null,
        descriptionSourceFieldKey:
          needsDescription === "preFilled" ? descriptionSourceFieldKey.trim() || null : null,
        descriptionFixedText:
          needsDescription === "fixed" ? descriptionFixedText.trim() || null : null,
        notes: templateNotes.trim() || null,
      },
      binding: {
        customLabel: customLabel.trim() || null,
        dayOfWeek,
        publishTime,
        isActive,
        defaultAssigneeMonteurId: monteurId || null,
        defaultAssigneeCmId: cmId || null,
        defaultAssigneeVideasteId: videasteId || null,
        captionPresetIdOverride: captionPresetOverride || null,
        descriptionPromptIdOverride: descriptionPromptOverride || null,
        coverModeOverride: coverModeOverride || null,
        notes: bindingNotes.trim() || null,
      },
    });
  }

  const headerTitle = customLabel.trim() || label.trim() || "Nouvelle recette";

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
        {tab === "content" && (
          <ContentTab
            reuseMode={reuseMode}
            sharedWarning={sharedWarning}
            sharedWithCount={initial.sharedWithCount}
            label={label}
            setLabel={setLabel}
            source={source}
            setSource={setSource}
            templateId={templateId}
            setTemplateId={setTemplateId}
            coverMode={coverMode}
            setCoverMode={setCoverMode}
            needsCaptionsMode={needsCaptionsMode}
            setNeedsCaptionsMode={setNeedsCaptionsMode}
            needsDescription={needsDescription}
            setNeedsDescription={setNeedsDescription}
            needsAdminValidation={needsAdminValidation}
            setNeedsAdminValidation={setNeedsAdminValidation}
            needsClientValidation={needsClientValidation}
            setNeedsClientValidation={setNeedsClientValidation}
            allowsClientRevision={allowsClientRevision}
            setAllowsClientRevision={setAllowsClientRevision}
            needsBrief={needsBrief}
            setNeedsBrief={setNeedsBrief}
            requiresEntityTypeId={requiresEntityTypeId}
            setRequiresEntityTypeId={setRequiresEntityTypeId}
            entityTypes={entityTypes}
            captionPresetId={captionPresetId}
            setCaptionPresetId={setCaptionPresetId}
            descriptionPromptId={descriptionPromptId}
            setDescriptionPromptId={setDescriptionPromptId}
            descriptionSourceFieldKey={descriptionSourceFieldKey}
            setDescriptionSourceFieldKey={setDescriptionSourceFieldKey}
            descriptionFixedText={descriptionFixedText}
            setDescriptionFixedText={setDescriptionFixedText}
            propertyFieldKeys={propertyFieldKeys}
            templateNotes={templateNotes}
            setTemplateNotes={setTemplateNotes}
            builderTemplates={builderTemplates}
            captionPresets={captionPresets}
            descriptionPrompts={descriptionPrompts}
          />
        )}

        {tab === "planning" && (
          <PlanningTab
            customLabel={customLabel}
            setCustomLabel={setCustomLabel}
            labelFallback={label || "Recette"}
            publishTime={publishTime}
            setPublishTime={setPublishTime}
            dayOfWeek={dayOfWeek}
            toggleDay={toggleDay}
            isActive={isActive}
            setIsActive={setIsActive}
            monteurId={monteurId}
            setMonteurId={setMonteurId}
            cmId={cmId}
            setCmId={setCmId}
            videasteId={videasteId}
            setVideasteId={setVideasteId}
            monteurs={monteurs}
            cms={cms}
            videastes={videastes}
          />
        )}

        {tab === "advanced" && (
          <AdvancedTab
            captionPresetOverride={captionPresetOverride}
            setCaptionPresetOverride={setCaptionPresetOverride}
            descriptionPromptOverride={descriptionPromptOverride}
            setDescriptionPromptOverride={setDescriptionPromptOverride}
            coverModeOverride={coverModeOverride}
            setCoverModeOverride={setCoverModeOverride}
            bindingNotes={bindingNotes}
            setBindingNotes={setBindingNotes}
            captionPresets={captionPresets}
            descriptionPrompts={descriptionPrompts}
          />
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

// ─────────────────────────────────────────────────────────────────────────────

interface ContentTabProps {
  reuseMode: boolean;
  sharedWarning: boolean;
  sharedWithCount: number;
  label: string;
  setLabel: (v: string) => void;
  source: string;
  setSource: (v: string) => void;
  templateId: string;
  setTemplateId: (v: string) => void;
  coverMode: string;
  setCoverMode: (v: string) => void;
  needsCaptionsMode: string;
  setNeedsCaptionsMode: (v: string) => void;
  needsDescription: string;
  setNeedsDescription: (v: string) => void;
  needsAdminValidation: boolean;
  setNeedsAdminValidation: (v: boolean) => void;
  needsClientValidation: boolean;
  setNeedsClientValidation: (v: boolean) => void;
  allowsClientRevision: boolean;
  setAllowsClientRevision: (v: boolean) => void;
  needsBrief: boolean;
  setNeedsBrief: (v: boolean) => void;
  requiresEntityTypeId: string;
  setRequiresEntityTypeId: (v: string) => void;
  entityTypes: { id: string; name: string }[];
  captionPresetId: string;
  setCaptionPresetId: (v: string) => void;
  descriptionPromptId: string;
  setDescriptionPromptId: (v: string) => void;
  descriptionSourceFieldKey: string;
  setDescriptionSourceFieldKey: (v: string) => void;
  descriptionFixedText: string;
  setDescriptionFixedText: (v: string) => void;
  propertyFieldKeys: { key: string; label: string }[];
  templateNotes: string;
  setTemplateNotes: (v: string) => void;
  builderTemplates: { id: string; name: string }[];
  captionPresets: { id: string; name: string }[];
  descriptionPrompts: { id: string; name: string }[];
}

function ContentTab(p: ContentTabProps) {
  if (p.reuseMode) {
    return (
      <p className="text-[12px] text-muted-foreground">
        Recette importée du catalogue — son contenu reste géré globalement.
        Pour modifier le contenu, va sur /admin/patterns.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {p.sharedWarning && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-warning-50 border border-warning-200 text-warning-700 text-[12px]">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            Recette utilisée par {p.sharedWithCount} comptes. Les modifications
            de contenu s&apos;appliquent partout.
          </span>
        </div>
      )}

      <FormField label="Nom de la recette" required>
        <Input value={p.label} onChange={p.setLabel} placeholder="Ex : Reels marché immo" />
      </FormField>

      <FormField label="Source" help={SOURCE_HELP[p.source]}>
        <div className="flex flex-wrap gap-1.5">
          {SOURCE_OPTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => p.setSource(s)}
              className={`h-8 px-3 rounded-md text-[12px] font-medium border transition-colors ${
                p.source === s
                  ? "bg-foreground text-background border-foreground"
                  : "bg-card text-foreground border-border hover:bg-muted"
              }`}
            >
              {SOURCE_LABELS_FR[s] ?? s}
            </button>
          ))}
        </div>
      </FormField>

      {p.source === "auto_template" && (
        <FormField label="Template builder" help="Le rendu vidéo utilise ce template.">
          <Combobox
            value={p.templateId}
            onChange={p.setTemplateId}
            options={[
              { value: "", label: "— Aucun —" },
              ...p.builderTemplates.map((t) => ({ value: t.id, label: t.name })),
            ]}
          />
        </FormField>
      )}

      <FormField label="Cover Instagram">
        <Combobox
          value={p.coverMode}
          onChange={p.setCoverMode}
          options={COVER_MODE_OPTIONS.map((m) => ({
            value: m,
            label: COVER_MODE_LABELS_FR[m] ?? m,
          }))}
        />
      </FormField>

      <FormField label="Sous-titres">
        <Combobox
          value={p.needsCaptionsMode}
          onChange={p.setNeedsCaptionsMode}
          options={CAPTIONS_MODE_OPTIONS.map((m) => ({
            value: m,
            label: CAPTIONS_MODE_LABELS_FR[m] ?? m,
          }))}
        />
      </FormField>

      {p.needsCaptionsMode === "auto" && (
        <FormField label="Preset captions">
          <Combobox
            value={p.captionPresetId}
            onChange={p.setCaptionPresetId}
            options={[
              { value: "", label: "— Preset par défaut —" },
              ...p.captionPresets.map((cp) => ({ value: cp.id, label: cp.name })),
            ]}
          />
        </FormField>
      )}

      <FormField label="Description Instagram">
        <Combobox
          value={p.needsDescription}
          onChange={p.setNeedsDescription}
          options={DESCRIPTION_MODE_OPTIONS.map((m) => ({
            value: m,
            label: NEEDS_DESCRIPTION_LABELS_FR[m] ?? m,
          }))}
        />
      </FormField>

      {p.needsDescription === "autoGenerate" && (
        <FormField label="Prompt description">
          <Combobox
            value={p.descriptionPromptId}
            onChange={p.setDescriptionPromptId}
            options={[
              { value: "", label: "— Prompt par défaut —" },
              ...p.descriptionPrompts.map((dp) => ({ value: dp.id, label: dp.name })),
            ]}
          />
        </FormField>
      )}

      {p.needsDescription === "preFilled" && (
        <FormField
          label="Champ du bien qui pré-remplit la légende"
          help="La légende démarre avec la valeur de ce champ du bien rattaché. Réécrite à chaque changement de bien."
        >
          <Combobox
            value={p.descriptionSourceFieldKey}
            onChange={p.setDescriptionSourceFieldKey}
            allowCustom
            placeholder="ex : description"
            options={p.propertyFieldKeys.map((f) => ({
              value: f.key,
              label: f.label === f.key ? f.key : `${f.label} · ${f.key}`,
            }))}
          />
        </FormField>
      )}

      {p.needsDescription === "fixed" && (
        <FormField
          label="Texte pré-rempli (fixe)"
          help="Pré-remplit la légende à la création, indépendamment du bien. Le CM peut l'ajuster ensuite."
        >
          <Textarea
            value={p.descriptionFixedText}
            onChange={(v) => p.setDescriptionFixedText(v)}
            rows={5}
            placeholder="Texte de légende par défaut…"
          />
        </FormField>
      )}

      <FormField
        label="Exige une fiche"
        help="Une fiche de ce type doit être rattachée pour créer un slot depuis cette recette."
      >
        <Combobox
          value={p.requiresEntityTypeId}
          onChange={p.setRequiresEntityTypeId}
          options={[
            { value: "", label: "Aucune" },
            ...p.entityTypes.map((t) => ({ value: t.id, label: t.name })),
          ]}
        />
      </FormField>

      <FormField label="Workflow">
        <div className="space-y-1.5 text-[12.5px]">
          <FlagCheckbox
            checked={p.needsBrief}
            onChange={p.setNeedsBrief}
            label="Brief obligatoire avant production"
          />
          <FlagCheckbox
            checked={p.needsAdminValidation}
            onChange={p.setNeedsAdminValidation}
            label="Validation admin avant publication"
          />
          <FlagCheckbox
            checked={p.needsClientValidation}
            onChange={p.setNeedsClientValidation}
            label="Validation client avant publication"
          />
          <FlagCheckbox
            checked={p.allowsClientRevision}
            onChange={p.setAllowsClientRevision}
            label="Client peut demander une révision"
          />
        </div>
      </FormField>

      <FormField label="Notes (privées)">
        <Textarea value={p.templateNotes} onChange={p.setTemplateNotes} rows={2} />
      </FormField>
    </div>
  );
}

function FlagCheckbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer hover:bg-muted/40 rounded-md px-2 py-1">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-border"
      />
      <span className="text-foreground">{label}</span>
    </label>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface PlanningTabProps {
  customLabel: string;
  setCustomLabel: (v: string) => void;
  labelFallback: string;
  publishTime: string;
  setPublishTime: (v: string) => void;
  dayOfWeek: number[];
  toggleDay: (d: number) => void;
  isActive: boolean;
  setIsActive: (v: boolean) => void;
  monteurId: string;
  setMonteurId: (v: string) => void;
  cmId: string;
  setCmId: (v: string) => void;
  videasteId: string;
  setVideasteId: (v: string) => void;
  monteurs: { id: string; name: string }[];
  cms: { id: string; name: string }[];
  videastes: { id: string; name: string }[];
}

function PlanningTab(p: PlanningTabProps) {
  return (
    <div className="space-y-4">
      <FormField label="Nom affiché pour ce compte" help="Vide = hérite du nom global de la recette.">
        <Input value={p.customLabel} onChange={p.setCustomLabel} placeholder={p.labelFallback} />
      </FormField>

      <FormField label="Heure de publication" required>
        <TimePicker value={p.publishTime} onChange={p.setPublishTime} />
      </FormField>

      <FormField
        label="Jours auto-générés"
        help={
          p.dayOfWeek.length === 0
            ? "Aucun jour sélectionné : aucune génération auto, slots créés à la main."
            : undefined
        }
      >
        <div className="inline-flex gap-1.5 flex-wrap">
          {DAYS.map((d) => {
            const active = p.dayOfWeek.includes(d.value);
            return (
              <button
                type="button"
                key={d.value}
                onClick={() => p.toggleDay(d.value)}
                className={`h-8 px-3 rounded-md text-[12px] font-medium border transition-colors ${
                  active
                    ? "bg-foreground text-background border-foreground"
                    : "bg-card text-foreground border-border hover:bg-muted"
                }`}
              >
                {d.label}
              </button>
            );
          })}
        </div>
      </FormField>

      <FormField label="Vidéaste défaut">
        <Combobox
          value={p.videasteId}
          onChange={p.setVideasteId}
          options={[
            { value: "", label: "— Aucun —" },
            ...p.videastes.map((u) => ({ value: u.id, label: u.name })),
          ]}
        />
      </FormField>
      <FormField label="Monteur défaut">
        <Combobox
          value={p.monteurId}
          onChange={p.setMonteurId}
          options={[
            { value: "", label: "— Aucun —" },
            ...p.monteurs.map((u) => ({ value: u.id, label: u.name })),
          ]}
        />
      </FormField>
      <FormField label="CM défaut">
        <Combobox
          value={p.cmId}
          onChange={p.setCmId}
          options={[
            { value: "", label: "— Aucun —" },
            ...p.cms.map((u) => ({ value: u.id, label: u.name })),
          ]}
        />
      </FormField>

      <label className="flex items-center gap-3 p-2.5 rounded-md hover:bg-muted/40 cursor-pointer">
        <input
          type="checkbox"
          checked={p.isActive}
          onChange={(e) => p.setIsActive(e.target.checked)}
          className="h-4 w-4 rounded border-border"
        />
        <span className="text-[13px] text-foreground">
          Recette active (sinon le cron ignore la génération auto)
        </span>
      </label>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface AdvancedTabProps {
  captionPresetOverride: string;
  setCaptionPresetOverride: (v: string) => void;
  descriptionPromptOverride: string;
  setDescriptionPromptOverride: (v: string) => void;
  coverModeOverride: string;
  setCoverModeOverride: (v: string) => void;
  bindingNotes: string;
  setBindingNotes: (v: string) => void;
  captionPresets: { id: string; name: string }[];
  descriptionPrompts: { id: string; name: string }[];
}

function AdvancedTab(p: AdvancedTabProps) {
  return (
    <div className="space-y-4">
      <p className="text-[12px] text-muted-foreground">
        Dévie la recette pour ce compte uniquement. La majorité des comptes laissent ces champs hérités.
      </p>
      <FormField label="Preset captions (override)">
        <Combobox
          value={p.captionPresetOverride}
          onChange={p.setCaptionPresetOverride}
          options={[
            { value: "", label: "Hérite de la recette" },
            ...p.captionPresets.map((cp) => ({ value: cp.id, label: cp.name })),
          ]}
        />
      </FormField>
      <FormField label="Prompt description (override)">
        <Combobox
          value={p.descriptionPromptOverride}
          onChange={p.setDescriptionPromptOverride}
          options={[
            { value: "", label: "Hérite de la recette" },
            ...p.descriptionPrompts.map((dp) => ({ value: dp.id, label: dp.name })),
          ]}
        />
      </FormField>
      <FormField label="Mode cover (override)">
        <Combobox
          value={p.coverModeOverride}
          onChange={p.setCoverModeOverride}
          options={COVER_OVERRIDE_OPTIONS}
        />
      </FormField>
      <FormField label="Notes de l'application (privées)">
        <Textarea value={p.bindingNotes} onChange={p.setBindingNotes} rows={2} />
      </FormField>
    </div>
  );
}
