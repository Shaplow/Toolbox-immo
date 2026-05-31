"use client";

/**
 * AccountPatternForm — édition / création d'un AccountPattern.
 *
 * Refonte MID Liquid Glass : Drawer right size xl + 4 Tabs structurés
 * (Identité / Production / Workflow / Équipe). Sticky banner xfield errors,
 * Combobox au lieu de selects HTML, AssigneePicker pour les défauts d'équipe.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, IdCard, Sparkles, Users, Workflow, Save } from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";
import { Tabs } from "@/components/ui/Tabs";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { FormField } from "@/components/ui/FormField";
import { Combobox } from "@/components/ui/Combobox";
import { Switch } from "@/components/ui/Switch";
import { TimePicker } from "@/components/ui/TimePicker";
import { AssigneePicker } from "@/components/ui/molecules/AssigneePicker";
import { toast } from "@/components/ui/Toast";
import { CoverConfigEditor } from "./CoverConfigEditor";
import {
  validatePatternConfig,
  type PatternValidationError,
} from "@/lib/publications/patternValidation";
import {
  SOURCE_LABELS_FR,
  SOURCE_HELP,
  COVER_MODE_LABELS_FR,
  COVER_MODE_HELP,
  NEEDS_DESCRIPTION_LABELS_FR,
  NEEDS_DESCRIPTION_HELP,
} from "@/lib/ui/domainLabels";

function parseCoverConfig(json: string): object | null {
  if (!json.trim()) return null;
  try {
    return JSON.parse(json) as object;
  } catch {
    return null;
  }
}

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

type UserOption = { id: string; name: string | null; email?: string | null; role: string };
type TemplateOption = { id: string; name: string };

type Props = {
  accountId: string;
  initialValues?: AccountPatternRow | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
};

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

const SOURCE_OPTIONS = (
  ["auto_template", "manual_rushes", "external_upload"] as const
).map((value) => ({ value, label: SOURCE_LABELS_FR[value] }));

const COVER_MODE_OPTIONS = (
  ["none", "manualSelect", "autoPack", "monteurUpload"] as const
).map((value) => ({ value, label: COVER_MODE_LABELS_FR[value] }));

const DESCRIPTION_OPTIONS = (
  ["none", "preFilled", "autoGenerate", "manualWrite"] as const
).map((value) => ({ value, label: NEEDS_DESCRIPTION_LABELS_FR[value] }));

// ─── Validation ───────────────────────────────────────────────────────────────

const PUBLISH_TIME_RE = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;

function validate(values: FormValues): Partial<Record<keyof FormValues, string>> {
  const errors: Partial<Record<keyof FormValues, string>> = {};
  if (!values.label.trim()) errors.label = "Le label est requis";
  if (values.daysOfWeek.length > 0 && !PUBLISH_TIME_RE.test(values.publishTime)) {
    errors.publishTime = "Format HH:MM requis";
  }
  return errors;
}

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

type TabKey = "identity" | "production" | "workflow" | "team";

// ─── AccountPatternForm ───────────────────────────────────────────────────────

export function AccountPatternForm({
  accountId,
  initialValues,
  open,
  onClose,
  onSaved,
}: Props) {
  const isEdit = !!initialValues;
  const [values, setValues] = useState<FormValues>(() => defaultValues(initialValues));
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues, string>>>({});
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<TabKey>("identity");

  // Options fetched client-side
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [captionPresets, setCaptionPresets] = useState<{ id: string; name: string }[]>([]);
  const [descriptionPrompts, setDescriptionPrompts] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    setValues(defaultValues(initialValues));
    setErrors({});
    setTab("identity");
  }, [initialValues, open]);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const [tplRes, usersRes, presetsRes, promptsRes] = await Promise.all([
          fetch("/api/templates"),
          fetch("/api/admin/users"),
          fetch("/api/caption-presets"),
          fetch("/api/description/prompts"),
        ]);
        if (tplRes.ok) {
          const tpls = (await tplRes.json()) as TemplateOption[];
          setTemplates(tpls.map((t) => ({ id: t.id, name: t.name })));
        }
        if (usersRes.ok) {
          setUsers((await usersRes.json()) as UserOption[]);
        }
        if (presetsRes.ok) {
          setCaptionPresets((await presetsRes.json()) as { id: string; name: string }[]);
        }
        if (promptsRes.ok) {
          const prompts = (await promptsRes.json()) as {
            id: string;
            name: string;
            isActive: boolean;
          }[];
          setDescriptionPrompts(prompts.filter((p) => p.isActive));
        }
      } catch {
        // Non-fatal
      }
    })();
  }, [open]);

  const set = useCallback(<K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  }, []);

  // ── Xfield validation ────────────────────────────────────────────────────
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
      null,
    );
  }, [values]);

  const xfieldErrorsByField = useMemo<Partial<Record<keyof FormValues, string>>>(() => {
    const map: Partial<Record<keyof FormValues, string>> = {};
    for (const err of xfieldErrors) {
      const field = mapXfieldCodeToFormKey(err.code);
      if (field && !map[field]) map[field] = err.message;
    }
    return map;
  }, [xfieldErrors]);

  // ── Filtered users per role ────────────────────────────────────────────
  const monteurUsers = useMemo(
    () => users.filter((u) => u.role === "MONTEUR" || u.role === "ADMIN"),
    [users],
  );
  const cmUsers = useMemo(
    () => users.filter((u) => u.role === "CM" || u.role === "ADMIN"),
    [users],
  );
  const videasteUsers = useMemo(
    () => users.filter((u) => u.role === "VIDEASTE" || u.role === "ADMIN"),
    [users],
  );

  const templateOptions = useMemo(
    () => [
      { value: "", label: "— Choisir un template —" },
      ...templates.map((t) => ({ value: t.id, label: t.name })),
    ],
    [templates],
  );

  const captionPresetOptions = useMemo(
    () => [
      {
        value: "",
        label:
          captionPresets.length === 0
            ? "Aucun preset disponible — créez-en un dans /captions"
            : "— Choisir un preset —",
      },
      ...captionPresets.map((p) => ({ value: p.id, label: p.name })),
    ],
    [captionPresets],
  );

  const descriptionPromptOptions = useMemo(
    () => [
      {
        value: "",
        label:
          descriptionPrompts.length === 0
            ? "Aucun prompt disponible — créez-en un dans /admin/prompts"
            : "— Choisir un prompt —",
      },
      ...descriptionPrompts.map((p) => ({ value: p.id, label: p.name })),
    ],
    [descriptionPrompts],
  );

  // ── Submit ───────────────────────────────────────────────────────────────
  async function handleSubmit() {
    const newErrors = validate(values);
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      // Jump à l'onglet où vit l'erreur.
      if (newErrors.label) setTab("identity");
      else if (newErrors.publishTime) setTab("identity");
      return;
    }

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
        // needsRushes est dérivé automatiquement de la source — pas de toggle UI.
        // manual_rushes ⇒ true (le vidéaste livre des rushes par définition).
        // auto_template / external_upload ⇒ false (génération auto OU upload direct
        // de la version finale, pas d'étape "rushes intermédiaires").
        needsRushes: values.source === "manual_rushes",
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
        const data = (await res.json()) as {
          error?: string;
          validationErrors?: PatternValidationError[];
        };
        if (res.status === 422 && Array.isArray(data.validationErrors)) {
          const fieldErrors: Partial<Record<keyof FormValues, string>> = {};
          for (const err of data.validationErrors) {
            const field = mapXfieldCodeToFormKey(err.code);
            if (field && !fieldErrors[field]) fieldErrors[field] = err.message;
          }
          if (Object.keys(fieldErrors).length > 0) {
            setErrors((prev) => ({ ...prev, ...fieldErrors }));
          }
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

  // ── Tabs config ──────────────────────────────────────────────────────────
  const tabItems = [
    { id: "identity", label: "Identité", icon: IdCard },
    { id: "production", label: "Production", icon: Sparkles },
    { id: "workflow", label: "Workflow", icon: Workflow },
    { id: "team", label: "Équipe", icon: Users },
  ];

  // Counters d'erreurs par tab pour badge sur tab
  const tabErrorCounts: Record<TabKey, number> = {
    identity: (errors.label ? 1 : 0) + (errors.publishTime ? 1 : 0),
    production:
      (xfieldErrorsByField.templateId ? 1 : 0) +
      (xfieldErrorsByField.coverConfigJson ? 1 : 0) +
      (xfieldErrorsByField.captionPresetId ? 1 : 0) +
      (xfieldErrorsByField.descriptionPromptId ? 1 : 0),
    workflow: xfieldErrorsByField.allowsClientRevision ? 1 : 0,
    team: 0,
  };

  return (
    <Drawer open={open} onClose={onClose} side="right" size="xl">
      {/* Header */}
      <header className="shrink-0 px-5 pt-5 pb-3 border-b border-white/30">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">
              {isEdit ? "Édition pattern" : "Nouveau pattern"}
            </p>
            <h2 className="mt-1 text-[18px] font-semibold tracking-tight text-gray-950 truncate leading-tight">
              {values.label || (isEdit ? "Sans titre" : "Pattern de publication")}
            </h2>
            <div className="mt-2 inline-flex items-center gap-2">
              <Switch
                checked={values.isActive}
                onChange={(v) => set("isActive", v)}
                size="sm"
                accent="default"
              />
              <span className="text-[11px] text-gray-600">
                {values.isActive ? "Actif" : "Inactif"}
              </span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-4">
          <Tabs
            items={tabItems.map((t) => ({
              ...t,
              badge:
                tabErrorCounts[t.id as TabKey] > 0 ? (
                  <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-rose-50 text-rose-700 text-[10px] font-semibold tabular-nums shadow-[inset_0_0_0_1px_rgba(201,113,133,0.22)]">
                    {tabErrorCounts[t.id as TabKey]}
                  </span>
                ) : undefined,
            }))}
            value={tab}
            onChange={(v) => setTab(v as TabKey)}
            variant="line"
            size="sm"
          />
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
        {/* Banner xfield errors */}
        {xfieldErrors.length > 0 && (
          <div className="flex items-start gap-2 rounded-xl bg-peach-50/70 backdrop-blur-[8px] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(245,158,107,0.25)]">
            <AlertTriangle size={16} className="text-peach-700 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-semibold text-peach-900">
                Configuration incohérente ({xfieldErrors.length} problème
                {xfieldErrors.length > 1 ? "s" : ""})
              </p>
              <ul className="mt-1 space-y-0.5 text-[11px] text-peach-800 list-disc list-inside">
                {xfieldErrors.map((err) => (
                  <li key={err.code}>{err.message}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Tab Identité */}
        {tab === "identity" && (
          <div className="space-y-4">
            <FormField label="Label" required error={errors.label}>
              <Input
                value={values.label}
                onChange={(v) => set("label", v)}
                maxLength={100}
                placeholder="Ex : Post Lundi 9h"
                error={errors.label}
              />
            </FormField>

            <FormField label="Source du contenu">
              <Combobox
                value={values.source}
                onChange={(v) => set("source", v)}
                options={SOURCE_OPTIONS}
              />
              {SOURCE_HELP[values.source] && (
                <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">
                  {SOURCE_HELP[values.source]}
                </p>
              )}
            </FormField>

            {values.source === "auto_template" && (
              <FormField
                label="Template"
                required
                error={errors.templateId ?? xfieldErrorsByField.templateId}
              >
                <Combobox
                  value={values.templateId}
                  onChange={(v) => set("templateId", v)}
                  options={templateOptions}
                  placeholder="— Choisir un template —"
                  emptyMessage="Aucun template trouvé"
                />
              </FormField>
            )}

            <div>
              <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500 mb-2">
                Jours de publication
              </p>
              <p className="text-[11px] text-gray-500 mb-2 leading-relaxed">
                Laisser vide pour un pattern manuel (template disponible dans le calendrier
                « Ajouter un slot »).
              </p>
              <div className="flex flex-wrap gap-2">
                {DAYS_OF_WEEK.map((day) => {
                  const checked = values.daysOfWeek.includes(day.value);
                  return (
                    <button
                      key={day.value}
                      type="button"
                      onClick={() => {
                        if (checked) {
                          set(
                            "daysOfWeek",
                            values.daysOfWeek.filter((d) => d !== day.value),
                          );
                        } else {
                          set(
                            "daysOfWeek",
                            [...values.daysOfWeek, day.value].sort((a, b) => a - b),
                          );
                        }
                      }}
                      className={[
                        "inline-flex items-center justify-center w-10 h-10 rounded-lg text-[11px] font-medium transition-all focus-ring",
                        checked
                          ? "bg-gradient-to-b from-gray-700 to-gray-900 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),inset_0_-1px_0_rgba(0,0,0,0.18),0_1px_2px_rgba(15,23,42,0.12)]"
                          : "bg-white/55 backdrop-blur-[8px] text-gray-600 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08)] hover:bg-white/85",
                      ].join(" ")}
                    >
                      {day.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <FormField
              label={
                values.daysOfWeek.length === 0
                  ? "Heure (ignorée — pattern manuel)"
                  : "Heure de publication"
              }
              required={values.daysOfWeek.length > 0}
              error={errors.publishTime}
            >
              <TimePicker
                value={values.publishTime}
                onChange={(v) => set("publishTime", v)}
                disabled={values.daysOfWeek.length === 0}
              />
            </FormField>

            <FormField label="Notes internes (optionnel)">
              <Textarea
                value={values.notes}
                onChange={(v) => set("notes", v)}
                placeholder="Notes internes sur ce pattern…"
                rows={3}
                maxLength={1000}
              />
            </FormField>
          </div>
        )}

        {/* Tab Production — 3 blocs cognitifs distincts (cover / captions / description) */}
        {tab === "production" && (
          <div className="space-y-6">
            {/* ─── Bloc 1 : Cover ─────────────────────────────────────────── */}
            <section className="space-y-3">
              <h3 className="text-[10px] uppercase tracking-widest font-semibold text-gray-700">
                Cover Instagram
              </h3>
              <FormField label="Mode cover">
                <Combobox
                  value={values.coverMode}
                  onChange={(v) => set("coverMode", v)}
                  options={COVER_MODE_OPTIONS}
                />
                {COVER_MODE_HELP[values.coverMode] && (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">
                    {COVER_MODE_HELP[values.coverMode]}
                  </p>
                )}
              </FormField>

              {values.coverMode === "autoPack" && (
                <FormField label="Configuration cover" error={xfieldErrorsByField.coverConfigJson}>
                  <CoverConfigEditor
                    templateId={values.templateId || null}
                    value={parseCoverConfig(values.coverConfigJson)}
                    onChange={(cfg) => set("coverConfigJson", JSON.stringify(cfg, null, 2))}
                  />
                </FormField>
              )}

              {values.coverMode === "monteurUpload" && values.source !== "manual_rushes" && (
                <p className="text-[11px] text-peach-800 bg-peach-50/70 rounded-md px-3 py-2 shadow-[inset_0_0_0_1px_rgba(245,158,107,0.2)]">
                  ⚠ Ce mode nécessite une source « manual_rushes » (la source actuelle est «{" "}
                  {values.source} »).
                </p>
              )}
            </section>

            {/* ─── Bloc 2 : Sous-titres ───────────────────────────────────── */}
            <section className="space-y-3 pt-4 border-t border-white/40">
              <h3 className="text-[10px] uppercase tracking-widest font-semibold text-gray-700">
                Sous-titres
              </h3>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-gray-950">Sous-titres auto</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    Génère et brûle des sous-titres sur la vidéo finale.
                  </p>
                </div>
                <Switch
                  checked={values.needsCaptions}
                  onChange={(v) => set("needsCaptions", v)}
                  accent="default"
                  size="sm"
                />
              </div>

              {values.needsCaptions && (
                <FormField
                  label="Preset captions par défaut"
                  required
                  error={xfieldErrorsByField.captionPresetId}
                >
                  <Combobox
                    value={values.captionPresetId}
                    onChange={(v) => set("captionPresetId", v)}
                    options={captionPresetOptions}
                    placeholder="— Choisir un preset —"
                    emptyMessage="Aucun preset"
                  />
                </FormField>
              )}
            </section>

            {/* ─── Bloc 3 : Description ───────────────────────────────────── */}
            <section className="space-y-3 pt-4 border-t border-white/40">
              <h3 className="text-[10px] uppercase tracking-widest font-semibold text-gray-700">
                Description Instagram
              </h3>
              <FormField label="Mode description">
                <Combobox
                  value={values.needsDescription}
                  onChange={(v) => set("needsDescription", v)}
                  options={DESCRIPTION_OPTIONS}
                />
                {NEEDS_DESCRIPTION_HELP[values.needsDescription] && (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">
                    {NEEDS_DESCRIPTION_HELP[values.needsDescription]}
                  </p>
                )}
              </FormField>

              {values.needsDescription !== "none" && (
                <FormField
                  label="Prompt description"
                  required={values.needsDescription === "autoGenerate"}
                  error={xfieldErrorsByField.descriptionPromptId}
                >
                  <Combobox
                    value={values.descriptionPromptId}
                    onChange={(v) => set("descriptionPromptId", v)}
                    options={descriptionPromptOptions}
                    placeholder="— Choisir un prompt —"
                    emptyMessage="Aucun prompt"
                  />
                </FormField>
              )}
            </section>
          </div>
        )}

        {/* Tab Workflow */}
        {tab === "workflow" && (
          <div className="space-y-2">
            {/* Toggle "Rushes vidéaste attendus" retiré (2026-05-31) : redondant
                avec la source — manual_rushes implique des rushes, auto_template
                et external_upload n'en ont pas. Dérivé auto à la sauvegarde. */}
            <WorkflowToggle
              label="Brief éditorial"
              description="Ajoute un champ Brief à remplir avant de lancer la production."
              checked={values.needsBrief}
              onChange={(v) => set("needsBrief", v)}
            />
            <WorkflowToggle
              label="Validation admin du montage"
              description="Le montage uploadé passe par l'admin (« À valider ») avant de continuer. Désactivé : la version uploadée devient automatiquement courante."
              checked={values.needsAdminValidation}
              onChange={(v) => set("needsAdminValidation", v)}
            />
            <WorkflowToggle
              label="Validation client (magic link)"
              description="Envoie un lien sans login au client pour valider la vidéo avant publication."
              checked={values.needsClientValidation}
              onChange={(v) => set("needsClientValidation", v)}
            />
            {values.needsClientValidation && (
              <div className="ml-3 pl-3 border-l-2 border-rose-200/60">
                <WorkflowToggle
                  label="Autoriser révisions client"
                  description="Si activé : le client peut refuser avec un commentaire (ping-pong jusqu'à validation). Sinon : valider ou annuler uniquement."
                  checked={values.allowsClientRevision}
                  onChange={(v) => set("allowsClientRevision", v)}
                  error={xfieldErrorsByField.allowsClientRevision}
                />
              </div>
            )}
          </div>
        )}

        {/* Tab Équipe */}
        {tab === "team" && (
          <div className="space-y-4">
            <p className="text-[12px] text-gray-500 leading-relaxed">
              Assignations par défaut pour les slots créés via ce pattern. Modifiables par
              slot dans le calendrier.
            </p>
            <FormField label="Vidéaste par défaut">
              <AssigneePicker
                value={values.defaultAssigneeVideasteId || null}
                onChange={(id) => set("defaultAssigneeVideasteId", id ?? "")}
                users={videasteUsers.map((u) => ({
                  id: u.id,
                  name: u.name ?? u.id,
                  email: u.email ?? undefined,
                  role: u.role,
                }))}
                allowedRoles={["VIDEASTE", "ADMIN"]}
                placeholder="Aucun vidéaste"
                groupByRole={false}
              />
            </FormField>
            <FormField label="Monteur par défaut">
              <AssigneePicker
                value={values.defaultAssigneeMonteurId || null}
                onChange={(id) => set("defaultAssigneeMonteurId", id ?? "")}
                users={monteurUsers.map((u) => ({
                  id: u.id,
                  name: u.name ?? u.id,
                  email: u.email ?? undefined,
                  role: u.role,
                }))}
                allowedRoles={["MONTEUR", "ADMIN"]}
                placeholder="Aucun monteur"
                groupByRole={false}
              />
            </FormField>
            <FormField label="Community manager par défaut">
              <AssigneePicker
                value={values.defaultAssigneeCmId || null}
                onChange={(id) => set("defaultAssigneeCmId", id ?? "")}
                users={cmUsers.map((u) => ({
                  id: u.id,
                  name: u.name ?? u.id,
                  email: u.email ?? undefined,
                  role: u.role,
                }))}
                allowedRoles={["CM", "ADMIN"]}
                placeholder="Aucun CM"
                groupByRole={false}
              />
            </FormField>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="shrink-0 flex items-center justify-end gap-2 px-5 py-3 bg-white/30 border-t border-white/30">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
          Annuler
        </Button>
        <Button
          variant="primary"
          size="sm"
          icon={Save}
          loading={loading}
          disabled={xfieldErrors.length > 0}
          onClick={() => void handleSubmit()}
        >
          {isEdit ? "Enregistrer" : "Créer le pattern"}
        </Button>
      </footer>
    </Drawer>
  );
}

// ─── WorkflowToggle ────────────────────────────────────────────────────────

function WorkflowToggle({
  label,
  description,
  checked,
  onChange,
  error,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  error?: string;
}) {
  return (
    <div
      className={[
        "rounded-xl p-3.5 transition-all",
        "bg-white/40 backdrop-blur-[8px]",
        error
          ? "shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(201,113,133,0.4)]"
          : "shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(15,23,42,0.06)]",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-gray-950 leading-tight">{label}</p>
          <p className="text-[11px] text-gray-600 mt-1 leading-relaxed">{description}</p>
          {error && <p className="text-[11px] text-rose-700 mt-1.5">{error}</p>}
        </div>
        <Switch checked={checked} onChange={onChange} size="sm" accent="default" />
      </div>
    </div>
  );
}
