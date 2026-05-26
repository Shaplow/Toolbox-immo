"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { FormField } from "@/components/ui/FormField";

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
  needsClientValidation: boolean;
  needsRushes: boolean;
  needsBrief: boolean;
  dayOfWeek: number;
  publishTime: string;
  isActive: boolean;
  defaultAssigneeMonteurId?: string | null;
  defaultAssigneeCmId?: string | null;
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
  needsClientValidation: boolean;
  needsRushes: boolean;
  needsBrief: boolean;
  dayOfWeek: string;
  publishTime: string;
  defaultAssigneeMonteurId: string;
  defaultAssigneeCmId: string;
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
      needsClientValidation: false,
      needsRushes: false,
      needsBrief: false,
      dayOfWeek: "1",
      publishTime: "09:00",
      defaultAssigneeMonteurId: "",
      defaultAssigneeCmId: "",
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
    needsClientValidation: initial.needsClientValidation,
    needsRushes: initial.needsRushes,
    needsBrief: initial.needsBrief,
    dayOfWeek: String(initial.dayOfWeek),
    publishTime: initial.publishTime,
    defaultAssigneeMonteurId: initial.defaultAssigneeMonteurId ?? "",
    defaultAssigneeCmId: initial.defaultAssigneeCmId ?? "",
    notes: initial.notes ?? "",
  };
}

// ─── Validation ───────────────────────────────────────────────────────────────

const PUBLISH_TIME_RE = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;

function validate(values: FormValues): Partial<Record<keyof FormValues, string>> {
  const errors: Partial<Record<keyof FormValues, string>> = {};
  if (!values.label.trim()) errors.label = "Le label est requis";
  const dow = Number(values.dayOfWeek);
  if (!Number.isInteger(dow) || dow < 1 || dow > 7) errors.dayOfWeek = "Jour invalide (1-7)";
  if (!PUBLISH_TIME_RE.test(values.publishTime)) errors.publishTime = "Format HH:MM requis";
  if (values.coverMode === "auto" && values.coverConfigJson.trim()) {
    try {
      JSON.parse(values.coverConfigJson);
    } catch {
      errors.coverConfigJson = "JSON invalide";
    }
  }
  return errors;
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
      const [tplRes, usersRes] = await Promise.all([
        fetch("/api/templates"),
        fetch("/api/admin/users"),
      ]);
      if (tplRes.ok) {
        const tpls = await tplRes.json() as TemplateOption[];
        setTemplates(tpls.map((t) => ({ id: t.id, name: t.name })));
      }
      if (usersRes.ok) {
        const users = await usersRes.json() as UserOption[];
        setMonteurs(users.filter((u) => u.role === "MONTEUR" || u.role === "ADMIN"));
        setCms(users.filter((u) => u.role === "CM" || u.role === "ADMIN"));
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const newErrors = validate(values);
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setLoading(true);
    try {
      let coverConfig: unknown = null;
      if (values.coverMode === "auto" && values.coverConfigJson.trim()) {
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
        needsClientValidation: values.needsClientValidation,
        needsRushes: values.needsRushes,
        needsBrief: values.needsBrief,
        dayOfWeek: Number(values.dayOfWeek),
        publishTime: values.publishTime,
        defaultAssigneeMonteurId: values.defaultAssigneeMonteurId || null,
        defaultAssigneeCmId: values.defaultAssigneeCmId || null,
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
        const data = await res.json() as { error?: string };
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
        className="fixed inset-0 bg-black/40 z-40"
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
                  <FormField label="Template">
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
                    { value: "none", label: "Aucune" },
                    { value: "manualSelect", label: "Sélection manuelle" },
                    { value: "auto", label: "Automatique" },
                  ]}
                />
                {values.coverMode === "auto" && (
                  <CoverConfigEditor
                    templateId={values.templateId || null}
                    value={parseCoverConfig(values.coverConfigJson)}
                    onChange={(cfg) => set("coverConfigJson", JSON.stringify(cfg, null, 2))}
                  />
                )}
              </Section>

              {/* ── Section 4 : Génération ── */}
              <Section title="Génération">
                <ToggleField
                  label="Captions"
                  checked={values.needsCaptions}
                  onChange={(v) => set("needsCaptions", v)}
                />
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
                <ToggleField
                  label="Validation client"
                  checked={values.needsClientValidation}
                  onChange={(v) => set("needsClientValidation", v)}
                />
                <ToggleField
                  label="Rushes"
                  checked={values.needsRushes}
                  onChange={(v) => set("needsRushes", v)}
                />
                <ToggleField
                  label="Brief"
                  checked={values.needsBrief}
                  onChange={(v) => set("needsBrief", v)}
                />
              </Section>

              {/* ── Section 5 : Planning ── */}
              <Section title="Planning">
                <div className="grid grid-cols-2 gap-4">
                  <FormField label="Jour de la semaine" required error={errors.dayOfWeek}>
                    <select
                      value={values.dayOfWeek}
                      onChange={(e) => set("dayOfWeek", e.target.value)}
                      className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 ${errors.dayOfWeek ? "border-red-300" : "border-gray-200"}`}
                    >
                      <option value="1">Lundi</option>
                      <option value="2">Mardi</option>
                      <option value="3">Mercredi</option>
                      <option value="4">Jeudi</option>
                      <option value="5">Vendredi</option>
                      <option value="6">Samedi</option>
                      <option value="7">Dimanche</option>
                    </select>
                  </FormField>
                  <FormField label="Heure de publication" required error={errors.publishTime}>
                    <input
                      type="time"
                      value={values.publishTime}
                      onChange={(e) => set("publishTime", e.target.value)}
                      className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 ${errors.publishTime ? "border-red-300" : "border-gray-200"}`}
                    />
                  </FormField>
                </div>
              </Section>

              {/* ── Section 6 : Assignations ── */}
              <Section title="Assignations (optionnel)">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
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
