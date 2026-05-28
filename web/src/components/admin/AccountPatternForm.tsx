"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { FormField } from "@/components/ui/FormField";
import {
  validatePatternConfig,
  type PatternValidationError,
} from "@/lib/publications/patternValidation";

function parseCoverConfig(json: string): object | null {
  if (!json.trim()) return null;
  try {
    return JSON.parse(json) as object;
  } catch {
    return null;
  }
}
import { toast } from "@/components/ui/Toast";
import { CoverConfigEditor } from "./CoverConfigEditor";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AccountPatternRow = {
  id: string;
  label: string;
  source: string;
  templateId: string | null;
  coverMode: string;
  coverConfig: unknown;
  needsDescription: string;
  needsCaptions: boolean;
  /** Phase 2.3 — validation admin du montage avant promote. */
  needsAdminValidation: boolean;
  needsClientValidation: boolean;
  allowsClientRevision: boolean;
  needsRushes: boolean;
  needsBrief: boolean;
  dayOfWeek: number[];
  publishTime: string;
  isActive: boolean;
  defaultAssigneeMonteurId?: string | null;
  defaultAssigneeCmId?: string | null;
  defaultAssigneeVideasteId?: string | null;
  captionPresetId?: string | null;
  descriptionPromptId?: string | null;
  notes?: string | null;
};

type UserOption = { id: string; name: string | null; role: string };
type TemplateOption = { id: string; name: string };

type Props = {
  accountId: string;
  initialValues?: AccountPatternRow | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
};

// ─── Form state ───────────────────────────────────────────────────────────────

type FormValues = {
  label: string;
  isActive: boolean;
  source: string;
  templateId: string;
  coverMode: string;
  coverConfigJson: string;
  needsCaptions: boolean;
  needsDescription: string;
  needsAdminValidation: boolean;
  needsClientValidation: boolean;
  allowsClientRevision: boolean;
  needsRushes: boolean;
  needsBrief: boolean;
  daysOfWeek: number[];
  publishTime: string;
  defaultAssigneeMonteurId: string;
  defaultAssigneeCmId: string;
  defaultAssigneeVideasteId: string;
  captionPresetId: string;
  descriptionPromptId: string;
  notes: string;
};

function defaultValues(initial?: AccountPatternRow | null): FormValues {
  if (!initial) {
    return {
      label: "",
      isActive: true,
      source: "auto_template",
      templateId: "",
      coverMode: "none",
      coverConfigJson: "",
      needsCaptions: false,
      needsDescription: "none",
      needsAdminValidation: false,
      needsClientValidation: false,
      allowsClientRevision: false,
      needsRushes: false,
      needsBrief: false,
      daysOfWeek: [1],
      publishTime: "09:00",
      defaultAssigneeMonteurId: "",
      defaultAssigneeCmId: "",
      defaultAssigneeVideasteId: "",
      captionPresetId: "",
      descriptionPromptId: "",
      notes: "",
    };
  }
  return {
    label: initial.label,
    isActive: initial.isActive,
    source: initial.source,
    templateId: initial.templateId ?? "",
    coverMode: initial.coverMode,
    coverConfigJson:
      initial.coverConfig != null ? JSON.stringify(initial.coverConfig, null, 2) : "",
    needsCaptions: initial.needsCaptions,
    needsDescription: initial.needsDescription,
    needsAdminValidation: initial.needsAdminValidation,
    needsClientValidation: initial.needsClientValidation,
    allowsClientRevision: initial.allowsClientRevision,
    needsRushes: initial.needsRushes,
    needsBrief: initial.needsBrief,
    daysOfWeek: Array.isArray(initial.dayOfWeek) ? initial.dayOfWeek : [initial.dayOfWeek],
    publishTime: initial.publishTime,
    defaultAssigneeMonteurId: initial.defaultAssigneeMonteurId ?? "",
    defaultAssigneeCmId: initial.defaultAssigneeCmId ?? "",
    defaultAssigneeVideasteId: initial.defaultAssigneeVideasteId ?? "",
    captionPresetId: initial.captionPresetId ?? "",
    descriptionPromptId: initial.descriptionPromptId ?? "",
    notes: initial.notes ?? "",
  };
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DAYS_OF_WEEK = [
  { value: 1, label: "Lun" },
  { value: 2, label: "Mar" },
  { value: 3, label: "Mer" },
  { value: 4, label: "Jeu" },
  { value: 5, label: "Ven" },
  { value: 6, label: "Sam" },
  { value: 7, label: "Dim" },
];

// ─── Validation ───────────────────────────────────────────────────────────────

const PUBLISH_TIME_RE = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;

function validate(values: FormValues): Partial<Record<keyof FormValues, string>> {
  const errors: Partial<Record<keyof FormValues, string>> = {};
  if (!values.label.trim()) errors.label = "Le label est requis";
  // daysOfWeek peut être vide → pattern manuel (template pour AddSlotModal, pas d'auto-gen).
  if (values.daysOfWeek.length > 0 && !PUBLISH_TIME_RE.test(values.publishTime)) {
    errors.publishTime = "Format HH:MM requis";
  }
  return errors;
}

/**
 * Mapping code d'erreur cross-field (helper centralisé) → clé FormValues
 * pour pouvoir afficher l'erreur sous le bon champ.
 */
function mapXfieldCodeToFormKey(code: string): keyof FormValues | null {
  switch (code) {
    case "MISSING_TEMPLATE":
      return "templateId";
    case "MISSING_COVER_PRESET_NAME":
    case "COVER_PRESET_NOT_FOUND":
      return "coverConfigJson";
    case "MISSING_CAPTION_PRESET":
      return "captionPresetId";
    case "MISSING_DESCRIPTION_PROMPT":
      return "descriptionPromptId";
    case "ALLOWS_REVISION_WITHOUT_VALIDATION":
      return "allowsClientRevision";
    default:
      return null;
  }
}

// ─── AccountPatternForm ───────────────────────────────────────────────────────

export function AccountPatternForm({ accountId, initialValues, open, onClose, onSaved }: Props) {
  const isEdit = !!initialValues;
  const [values, setValues] = useState<FormValues>(() => defaultValues(initialValues));
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues, string>>>({});
  const [loading, setLoading] = useState(false);

  // Options fetched client-side
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [monteurs, setMonteurs] = useState<UserOption[]>([]);
  const [cms, setCms] = useState<UserOption[]>([]);
  const [videastes, setVideastes] = useState<UserOption[]>([]);
  const [captionPresets, setCaptionPresets] = useState<{ id: string; name: string }[]>([]);
  const [descriptionPrompts, setDescriptionPrompts] = useState<{ id: string; name: string }[]>([]);

  const overlayRef = useRef<HTMLDivElement>(null);

  // Re-init when initialValues change (open new form)
  useEffect(() => {
    setValues(defaultValues(initialValues));
    setErrors({});
  }, [initialValues, open]);

  // Fetch options on open
  useEffect(() => {
    if (!open) return;
    void fetchOptions();
  }, [open]);

  async function fetchOptions() {
    try {
      const [tplRes, usersRes, presetsRes, promptsRes] = await Promise.all([
        fetch("/api/templates"),
        fetch("/api/admin/users"),
        fetch("/api/caption-presets"),
        fetch("/api/description/prompts"),
      ]);
      if (tplRes.ok) {
        const tpls = await tplRes.json() as TemplateOption[];
        setTemplates(tpls.map((t) => ({ id: t.id, name: t.name })));
      }
      if (usersRes.ok) {
        const users = await usersRes.json() as UserOption[];
        setMonteurs(users.filter((u) => u.role === "MONTEUR" || u.role === "ADMIN"));
        setCms(users.filter((u) => u.role === "CM" || u.role === "ADMIN"));
        // VIDÉASTE : seuls les rôles dédiés (un ADMIN peut filmer mais on n'élargit
        // pas pour éviter d'avoir 5 admins dans la liste de pickers terrain).
        setVideastes(users.filter((u) => u.role === "VIDEASTE" || u.role === "ADMIN"));
      }
      if (presetsRes.ok) {
        setCaptionPresets(await presetsRes.json() as { id: string; name: string }[]);
      }
      if (promptsRes.ok) {
        const prompts = await promptsRes.json() as { id: string; name: string; isActive: boolean }[];
        setDescriptionPrompts(prompts.filter((p) => p.isActive));
      }
    } catch {
      // Non-fatal — selects will be empty
    }
  }

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  // ── Validation cross-field (recalcul à chaque changement) ────────────────
  // C2 (preset cover orphelin) ne peut pas être vérifié côté client sans charger
  // les TemplateCoverPreset du template sélectionné — on le délègue au backend
  // qui retournera 422 si le preset référencé n'existe pas. Les 5 autres règles
  // sont vérifiées ici en temps réel pour feedback immédiat.
  const xfieldErrors = useMemo<PatternValidationError[]>(() => {
    const parsedCoverConfig = values.coverConfigJson.trim()
      ? (parseCoverConfig(values.coverConfigJson) as unknown)
      : null;
    return validatePatternConfig(
      {
        source: values.source,
        templateId: values.templateId || null,
        coverMode: values.coverMode,
        coverConfig: parsedCoverConfig,
        needsCaptions: values.needsCaptions,
        needsDescription: values.needsDescription,
        needsAdminValidation: values.needsAdminValidation,
        needsClientValidation: values.needsClientValidation,
        allowsClientRevision: values.allowsClientRevision,
        captionPresetId: values.captionPresetId || null,
        descriptionPromptId: values.descriptionPromptId || null,
      },
      null, // template context : skip C2 côté client, le backend tranche
    );
  }, [values]);

  /** Erreurs xfield projetées sur les champs du formulaire (pour affichage inline). */
  const xfieldErrorsByField = useMemo<Partial<Record<keyof FormValues, string>>>(() => {
    const map: Partial<Record<keyof FormValues, string>> = {};
    for (const err of xfieldErrors) {
      const field = mapXfieldCodeToFormKey(err.code);
      if (field && !map[field]) map[field] = err.message;
    }
    return map;
  }, [xfieldErrors]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const newErrors = validate(values);
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    // Bloquer si erreurs cross-field détectées côté client
    if (xfieldErrors.length > 0) {
      toast.error("Corrigez les conflits de configuration avant de sauvegarder.");
      return;
    }

    setLoading(true);
    try {
      let coverConfig: unknown = null;
      if (values.coverMode === "autoPack" && values.coverConfigJson.trim()) {
        coverConfig = JSON.parse(values.coverConfigJson);
      }

      const body = {
        label: values.label.trim(),
        isActive: values.isActive,
        source: values.source,
        templateId: values.templateId || null,
        coverMode: values.coverMode,
        coverConfig,
        needsCaptions: values.needsCaptions,
        needsDescription: values.needsDescription,
        needsAdminValidation: values.needsAdminValidation,
        needsClientValidation: values.needsClientValidation,
        allowsClientRevision: values.allowsClientRevision,
        needsRushes: values.needsRushes,
        needsBrief: values.needsBrief,
        dayOfWeek: values.daysOfWeek,
        publishTime: values.publishTime,
        defaultAssigneeMonteurId: values.defaultAssigneeMonteurId || null,
        defaultAssigneeCmId: values.defaultAssigneeCmId || null,
        defaultAssigneeVideasteId: values.defaultAssigneeVideasteId || null,
        captionPresetId: values.captionPresetId || null,
        descriptionPromptId: values.descriptionPromptId || null,
        notes: values.notes.trim() || null,
      };

      const url = isEdit
        ? `/api/admin/accounts/${accountId}/patterns/${initialValues!.id}`
        : `/api/admin/accounts/${accountId}/patterns`;
      const method = isEdit ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json() as {
          error?: string;
          validationErrors?: PatternValidationError[];
        };
        // 422 = erreurs xfield backend (C2 — preset cover orphelin), reporter inline
        if (res.status === 422 && Array.isArray(data.validationErrors)) {
          const fieldErrors: Partial<Record<keyof FormValues, string>> = {};
          for (const err of data.validationErrors) {
            const field = mapXfieldCodeToFormKey(err.code);
            if (field && !fieldErrors[field]) fieldErrors[field] = err.message;
          }
          if (Object.keys(fieldErrors).length > 0) setErrors((prev) => ({ ...prev, ...fieldErrors }));
        }
        toast.error(data.error ?? "Erreur lors de l'enregistrement");
        return;
      }

      toast.success("Pattern enregistré");
      onSaved();
      onClose();
    } catch {
      toast.error("Erreur réseau, veuillez réessayer");
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <>
      {/* Overlay */}
      <div
        ref={overlayRef}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pattern-form-title"
        className="fixed inset-0 z-50 flex items-center justify-center px-4 pointer-events-none"
      >
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl pointer-events-auto overflow-hidden flex flex-col max-h-[90vh]">
          {/* Header */}
          <div className="px-6 pt-6 pb-4 border-b border-gray-100 shrink-0">
            <h2 id="pattern-form-title" className="text-base font-semibold text-gray-900">
              {isEdit ? "Éditer le pattern" : "Nouveau pattern"}
            </h2>
          </div>

          {/* Scrollable body */}
          <form onSubmit={(e) => void handleSubmit(e)} className="overflow-y-auto flex-1">
            <div className="px-6 py-5 flex flex-col gap-6">

              {/* Bandeau warning xfield (cohérence config) */}
              {xfieldErrors.length > 0 && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <AlertTriangle size={16} className="text-amber-500 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-amber-900">
                      Configuration incohérente ({xfieldErrors.length} problème{xfieldErrors.length > 1 ? "s" : ""})
                    </p>
                    <ul className="mt-1 space-y-0.5 text-xs text-amber-800 list-disc list-inside">
                      {xfieldErrors.map((err) => (
                        <li key={err.code}>{err.message}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* ── Section 1 : Identité ── */}
              <Section title="Identité">
                <FormField label="Label" required error={errors.label}>
                  <Input
                    value={values.label}
                    onChange={(v) => set("label", v)}
                    maxLength={100}
                    placeholder="Ex : Post Lundi 9h"
                    error={errors.label}
                  />
                </FormField>
                <ToggleField
                  label="Actif"
                  checked={values.isActive}
                  onChange={(v) => set("isActive", v)}
                />
              </Section>

              {/* ── Section 2 : Source ── */}
              <Section title="Source">
                <RadioGroup
                  name="source"
                  value={values.source}
                  onChange={(v) => set("source", v)}
                  options={[
                    { value: "auto_template", label: "Auto template" },
                    { value: "manual_rushes", label: "Rushes externes (montage)" },
                    { value: "external_upload", label: "Upload externe" },
                  ]}
                />
                {values.source === "auto_template" && (
                  <FormField label="Template" error={xfieldErrorsByField.templateId}>
                    <SelectField
                      value={values.templateId}
                      onChange={(v) => set("templateId", v)}
                      options={templates}
                      placeholder="— Choisir un template —"
                    />
                  </FormField>
                )}
              </Section>

              {/* ── Section 3 : Cover ── */}
              <Section title="Cover">
                <RadioGroup
                  name="coverMode"
                  value={values.coverMode}
                  onChange={(v) => set("coverMode", v)}
                  options={[
                    { value: "none", label: "Pas de cover" },
                    { value: "manualSelect", label: "Sélection libre (CM)" },
                    { value: "autoPack", label: "Pack auto → sélection (CM)" },
                    { value: "monteurUpload", label: "Upload par le monteur" },
                  ]}
                />
                {/* Help text par mode pour clarifier qui fait quoi */}
                <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">
                  {values.coverMode === "none" &&
                    "Aucune cover. La section ne s'affiche pas sur la fiche."}
                  {values.coverMode === "manualSelect" &&
                    "La CM choisit librement une frame depuis la vidéo finale, sans config préalable."}
                  {values.coverMode === "autoPack" &&
                    "Le système extrait des frames via le preset configuré + place les groupes de texte. La CM valide la frame finale et ajuste."}
                  {values.coverMode === "monteurUpload" &&
                    "Le monteur uploade la cover en même temps que sa version. Pas de génération automatique. Nécessite une source « manual_rushes »."}
                </p>
                {/* Preset config visible seulement pour autoPack */}
                {values.coverMode === "autoPack" && (
                  <FormField label="" error={xfieldErrorsByField.coverConfigJson}>
                    <CoverConfigEditor
                      templateId={values.templateId || null}
                      value={parseCoverConfig(values.coverConfigJson)}
                      onChange={(cfg) => set("coverConfigJson", JSON.stringify(cfg, null, 2))}
                    />
                  </FormField>
                )}
                {/* Warning si monteurUpload + source pas manual_rushes */}
                {values.coverMode === "monteurUpload" && values.source !== "manual_rushes" && (
                  <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    ⚠ Ce mode nécessite une source « manual_rushes » (la source actuelle est « {values.source} »).
                  </p>
                )}
              </Section>

              {/* ── Section 4 : Génération ── */}
              <Section title="Génération">
                <ToggleField
                  label="Sous-titres auto"
                  hint="Génère et brûle des sous-titres sur la vidéo finale. Sinon, aucune étape captions n'apparaît dans la fiche."
                  checked={values.needsCaptions}
                  onChange={(v) => set("needsCaptions", v)}
                />
                {values.needsCaptions && (
                  <FormField
                    label="Preset captions par défaut"
                    required
                    error={xfieldErrorsByField.captionPresetId}
                  >
                    <SelectField
                      value={values.captionPresetId}
                      onChange={(v) => set("captionPresetId", v)}
                      options={captionPresets}
                      placeholder={
                        captionPresets.length === 0
                          ? "Aucun preset disponible — créez-en un dans /captions"
                          : "— Choisir un preset —"
                      }
                    />
                  </FormField>
                )}
                <FormField label="Description">
                  <select
                    value={values.needsDescription}
                    onChange={(e) => set("needsDescription", e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  >
                    <option value="none">Aucune</option>
                    <option value="preFilled">Pré-remplie</option>
                    <option value="autoGenerate">Auto-générée</option>
                    <option value="manualWrite">Manuelle</option>
                  </select>
                </FormField>
                {values.needsDescription !== "none" && (
                  <FormField
                    label="Prompt description par défaut"
                    required={values.needsDescription === "autoGenerate"}
                    error={xfieldErrorsByField.descriptionPromptId}
                  >
                    <SelectField
                      value={values.descriptionPromptId}
                      onChange={(v) => set("descriptionPromptId", v)}
                      options={descriptionPrompts}
                      placeholder={
                        descriptionPrompts.length === 0
                          ? "Aucun prompt disponible — créez-en un dans /admin/libraries/prompts"
                          : "— Choisir un prompt —"
                      }
                    />
                  </FormField>
                )}
                <ToggleField
                  label="Validation admin du montage"
                  hint="Si activé : le montage uploadé passe par l'admin (« À valider ») avant de continuer. Si désactivé : la version uploadée devient automatiquement courante et le CM prend la main."
                  checked={values.needsAdminValidation}
                  onChange={(v) => set("needsAdminValidation", v)}
                />
                <ToggleField
                  label="Validation client (magic link)"
                  hint="Envoie un lien sans login au client pour valider la vidéo avant publication."
                  checked={values.needsClientValidation}
                  onChange={(v) => set("needsClientValidation", v)}
                />
                {values.needsClientValidation && (
                  <div className="ml-4 pl-3 border-l-2 border-fuchsia-100">
                    <ToggleField
                      label="Autoriser révisions client"
                      hint="Si désactivé : le client peut uniquement valider ou annuler complètement. Si activé : le client peut refuser avec un commentaire (ping-pong jusqu'à validation)."
                      checked={values.allowsClientRevision}
                      onChange={(v) => set("allowsClientRevision", v)}
                    />
                  </div>
                )}
                <ToggleField
                  label="Rushes vidéaste attendus"
                  hint="Active l'étape « Montage » dans la fiche (le vidéaste livre des rushes, le monteur publie une version)."
                  checked={values.needsRushes}
                  onChange={(v) => set("needsRushes", v)}
                />
                <ToggleField
                  label="Brief éditorial"
                  hint="Ajoute un champ Brief à remplir avant de lancer la production (utile pour les patterns externes)."
                  checked={values.needsBrief}
                  onChange={(v) => set("needsBrief", v)}
                />
              </Section>

              {/* ── Section 5 : Planning ── */}
              <Section title="Planning">
                <p className="text-xs text-gray-500 -mt-1 mb-1 leading-relaxed">
                  Sans jour coché, le pattern n&apos;est pas auto-généré et reste disponible
                  comme template manuel dans le calendrier (« Ajouter un slot »).
                </p>
                <FormField label="Jours de publication (laisser vide pour un pattern manuel)" error={errors.daysOfWeek}>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {DAYS_OF_WEEK.map((day) => {
                      const checked = values.daysOfWeek.includes(day.value);
                      return (
                        <label
                          key={day.value}
                          className={`inline-flex items-center justify-center w-10 h-10 rounded-lg border text-xs font-medium cursor-pointer select-none transition-colors ${
                            checked
                              ? "bg-indigo-600 border-indigo-600 text-white"
                              : "bg-white border-gray-200 text-gray-600 hover:border-indigo-300 hover:text-indigo-600"
                          } ${errors.daysOfWeek ? "border-red-300" : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                set("daysOfWeek", [...values.daysOfWeek, day.value].sort((a, b) => a - b));
                              } else {
                                set("daysOfWeek", values.daysOfWeek.filter((d) => d !== day.value));
                              }
                            }}
                            className="sr-only"
                          />
                          {day.label}
                        </label>
                      );
                    })}
                  </div>
                  {errors.daysOfWeek && (
                    <p className="mt-1 text-xs text-red-600">{errors.daysOfWeek}</p>
                  )}
                </FormField>
                <FormField
                  label={values.daysOfWeek.length === 0 ? "Heure de publication (ignorée — pattern manuel)" : "Heure de publication"}
                  required={values.daysOfWeek.length > 0}
                  error={errors.publishTime}
                >
                  <input
                    type="time"
                    value={values.publishTime}
                    onChange={(e) => set("publishTime", e.target.value)}
                    className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 ${errors.publishTime ? "border-red-300" : "border-gray-200"}`}
                  />
                </FormField>
              </Section>

              {/* ── Section 6 : Assignations ── */}
              <Section title="Assignations (optionnel)">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField label="Vidéaste par défaut">
                    <SelectField
                      value={values.defaultAssigneeVideasteId}
                      onChange={(v) => set("defaultAssigneeVideasteId", v)}
                      options={videastes.map((u) => ({ id: u.id, name: u.name ?? u.id }))}
                      placeholder="— Aucun —"
                    />
                  </FormField>
                  <FormField label="Monteur par défaut">
                    <SelectField
                      value={values.defaultAssigneeMonteurId}
                      onChange={(v) => set("defaultAssigneeMonteurId", v)}
                      options={monteurs.map((u) => ({ id: u.id, name: u.name ?? u.id }))}
                      placeholder="— Aucun —"
                    />
                  </FormField>
                  <FormField label="CM par défaut">
                    <SelectField
                      value={values.defaultAssigneeCmId}
                      onChange={(v) => set("defaultAssigneeCmId", v)}
                      options={cms.map((u) => ({ id: u.id, name: u.name ?? u.id }))}
                      placeholder="— Aucun —"
                    />
                  </FormField>
                </div>
              </Section>

              {/* ── Section 7 : Notes ── */}
              <Section title="Notes">
                <FormField label="Notes internes (optionnel)">
                  <Textarea
                    value={values.notes}
                    onChange={(v) => set("notes", v)}
                    placeholder="Notes internes sur ce pattern…"
                    rows={3}
                    maxLength={1000}
                  />
                </FormField>
              </Section>

            </div>
          </form>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-6 py-4 bg-gray-50 border-t border-gray-100 shrink-0">
            <Button variant="ghost" size="md" onClick={onClose} disabled={loading}>
              Annuler
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={loading}
              disabled={xfieldErrors.length > 0}
              onClick={(e) => void handleSubmit(e as unknown as React.FormEvent)}
            >
              Enregistrer
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">{title}</h3>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

function RadioGroup({
  name,
  value,
  onChange,
  options,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-wrap gap-3">
      {options.map((opt) => (
        <label
          key={opt.value}
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs cursor-pointer transition-colors ${
            value === opt.value
              ? "bg-indigo-50 border-indigo-300 text-indigo-700 font-medium"
              : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
          }`}
        >
          <input
            type="radio"
            name={name}
            value={opt.value}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
            className="sr-only"
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}

function ToggleField({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="inline-flex items-center gap-3 cursor-pointer">
        <div className="relative">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            className="sr-only"
          />
          <div
            className={`w-9 h-5 rounded-full transition-colors ${checked ? "bg-indigo-600" : "bg-gray-200"}`}
          />
          <div
            className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${checked ? "translate-x-4" : "translate-x-0"}`}
          />
        </div>
        <span className="text-sm text-gray-700">{label}</span>
      </label>
      {hint && <p className="text-xs text-gray-500 ml-12">{hint}</p>}
    </div>
  );
}

function SelectField({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { id: string; name: string }[];
  placeholder: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
    >
      <option value="">{placeholder}</option>
      {options.map((opt) => (
        <option key={opt.id} value={opt.id}>
          {opt.name}
        </option>
      ))}
    </select>
  );
}
