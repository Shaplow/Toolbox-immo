"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { toast } from "@/components/ui/Toast";
import type { CoverPresetRow } from "./CoverPresetsPanel";

// ─── Types ────────────────────────────────────────────────────────────────────

type TemplateGroup = { id: string; name: string };

type FormState = {
  name: string;
  sortOrder: string;
  enabled: boolean;
  frameCount: string;
  overlayGroupIds: string[];
  offsetX: string;
  offsetY: string;
  advancedJson: string;
};

type Props = {
  templateId: string;
  preset?: CoverPresetRow | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildAdvancedJson(config: Record<string, unknown>): string {
  const advanced: Record<string, unknown> = {};
  if (config.excludeZones !== undefined) advanced.excludeZones = config.excludeZones;
  if (config.excludeSlotIds !== undefined) advanced.excludeSlotIds = config.excludeSlotIds;
  return Object.keys(advanced).length > 0 ? JSON.stringify(advanced, null, 2) : "";
}

function defaultForm(preset?: CoverPresetRow | null): FormState {
  if (!preset) {
    return {
      name: "",
      sortOrder: "0",
      enabled: true,
      frameCount: "36",
      overlayGroupIds: [],
      offsetX: "0",
      offsetY: "0",
      advancedJson: "",
    };
  }
  const c = preset.config;
  return {
    name: preset.name,
    sortOrder: String(preset.sortOrder),
    enabled: typeof c.enabled === "boolean" ? c.enabled : true,
    frameCount: String(typeof c.frameCount === "number" ? c.frameCount : 36),
    overlayGroupIds: Array.isArray(c.overlayGroupIds) ? (c.overlayGroupIds as string[]) : [],
    offsetX: String(typeof c.offsetX === "number" ? c.offsetX : 0),
    offsetY: String(typeof c.offsetY === "number" ? c.offsetY : 0),
    advancedJson: buildAdvancedJson(c),
  };
}

// ─── CoverPresetEditDialog ────────────────────────────────────────────────────

export function CoverPresetEditDialog({ templateId, preset, open, onClose, onSaved }: Props) {
  const isEdit = !!preset;
  const [form, setForm] = useState<FormState>(() => defaultForm(preset));
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [advancedError, setAdvancedError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  const [groups, setGroups] = useState<TemplateGroup[]>([]);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Re-init form when preset or open changes
  useEffect(() => {
    setForm(defaultForm(preset));
    setErrors({});
    setAdvancedError(undefined);
  }, [preset, open]);

  // Fetch template groups
  useEffect(() => {
    if (!open || !templateId) return;
    let cancelled = false;
    void fetch(`/api/templates/${templateId}`)
      .then((r) => (r.ok ? r.json() as Promise<{ groups?: TemplateGroup[] }> : null))
      .then((data) => { if (!cancelled && data) setGroups(data.groups ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [templateId, open]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function toggleOverlayGroup(groupId: string, checked: boolean) {
    const current = form.overlayGroupIds;
    const updated = checked ? [...current, groupId] : current.filter((id) => id !== groupId);
    set("overlayGroupIds", updated);
  }

  function handleAdvancedChange(raw: string) {
    set("advancedJson", raw);
    if (!raw.trim()) {
      setAdvancedError(undefined);
      return;
    }
    try {
      JSON.parse(raw);
      setAdvancedError(undefined);
    } catch {
      setAdvancedError("JSON invalide");
    }
  }

  function buildConfig(): Record<string, unknown> {
    const config: Record<string, unknown> = {
      enabled: form.enabled,
      frameCount: Math.min(72, Math.max(6, parseInt(form.frameCount, 10) || 36)),
      overlayGroupIds: form.overlayGroupIds,
      offsetX: parseInt(form.offsetX, 10) || 0,
      offsetY: parseInt(form.offsetY, 10) || 0,
    };
    if (form.advancedJson.trim()) {
      try {
        const parsed = JSON.parse(form.advancedJson) as Record<string, unknown>;
        if (parsed.excludeZones !== undefined) config.excludeZones = parsed.excludeZones;
        if (parsed.excludeSlotIds !== undefined) config.excludeSlotIds = parsed.excludeSlotIds;
      } catch {
        // Validation prevents submission with bad JSON
      }
    }
    return config;
  }

  function validate(): boolean {
    const newErrors: Partial<Record<keyof FormState, string>> = {};
    if (!form.name.trim()) newErrors.name = "Le nom est requis";
    if (form.name.trim().length > 100) newErrors.name = "Maximum 100 caractères";
    if (advancedError) newErrors.advancedJson = advancedError;
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    try {
      const body = {
        name: form.name.trim(),
        sortOrder: parseInt(form.sortOrder, 10) || 0,
        config: buildConfig(),
      };

      const url = isEdit
        ? `/api/templates/${templateId}/cover-presets/${preset!.id}`
        : `/api/templates/${templateId}/cover-presets`;
      const method = isEdit ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        toast.success(isEdit ? "Preset mis à jour" : "Preset créé");
        onSaved();
      } else {
        const data = await res.json() as { error?: string };
        if (res.status === 409) {
          toast.error("Un preset avec ce nom existe déjà.");
        } else {
          toast.error(data.error ?? "Erreur lors de l'enregistrement");
        }
      }
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
        aria-labelledby="cover-preset-dialog-title"
        className="fixed inset-0 z-50 flex items-center justify-center px-4 pointer-events-none"
      >
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg pointer-events-auto overflow-hidden flex flex-col max-h-[90vh]">

          {/* Header */}
          <div className="px-6 pt-5 pb-4 border-b border-gray-100 flex items-center justify-between shrink-0">
            <h2 id="cover-preset-dialog-title" className="text-base font-semibold text-gray-900">
              {isEdit ? "Modifier le preset cover" : "Nouveau preset cover"}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Fermer"
            >
              <X size={18} />
            </button>
          </div>

          {/* Scrollable body */}
          <form onSubmit={(e) => void handleSubmit(e)} className="overflow-y-auto flex-1">
            <div className="px-6 py-5 flex flex-col gap-4">

              {/* Name */}
              <FormField label="Nom" required error={errors.name}>
                <Input
                  value={form.name}
                  onChange={(v) => set("name", v)}
                  maxLength={100}
                  placeholder="Ex : Standard, Minimal, Vibrant…"
                  error={errors.name}
                />
              </FormField>

              {/* Sort order */}
              <FormField
                label="Ordre d'affichage"
                help="Entier — plus petit = affiché en premier."
              >
                <Input
                  type="number"
                  value={form.sortOrder}
                  onChange={(v) => set("sortOrder", v)}
                />
              </FormField>

              {/* Enabled */}
              <label className="inline-flex items-center gap-3 cursor-pointer">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(e) => set("enabled", e.target.checked)}
                    className="sr-only"
                  />
                  <div
                    className={`w-9 h-5 rounded-full transition-colors ${form.enabled ? "bg-indigo-600" : "bg-gray-200"}`}
                  />
                  <div
                    className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.enabled ? "translate-x-4" : "translate-x-0"}`}
                  />
                </div>
                <span className="text-sm text-gray-700">Activé</span>
              </label>

              {/* frameCount */}
              <FormField
                label="Nombre de frames proposées"
                help="Entre 6 et 72. Défaut : 36."
              >
                <Input
                  type="number"
                  value={form.frameCount}
                  onChange={(v) => set("frameCount", v)}
                  min={6}
                  max={72}
                />
              </FormField>

              {/* overlayGroupIds */}
              <FormField
                label="Groupes overlay"
                help="Groupes du template composés par-dessus le frame sélectionné."
              >
                {groups.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">Aucun groupe trouvé dans ce template.</p>
                ) : (
                  <div className="flex flex-wrap gap-2 mt-1">
                    {groups.map((group) => {
                      const isSelected = form.overlayGroupIds.includes(group.id);
                      return (
                        <label
                          key={group.id}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs cursor-pointer transition-colors ${
                            isSelected
                              ? "bg-indigo-50 border-indigo-300 text-indigo-700 font-medium"
                              : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => toggleOverlayGroup(group.id, e.target.checked)}
                            className="sr-only"
                          />
                          {group.name}
                        </label>
                      );
                    })}
                  </div>
                )}
              </FormField>

              {/* Offset */}
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Offset X (px)">
                  <Input
                    type="number"
                    value={form.offsetX}
                    onChange={(v) => set("offsetX", v)}
                  />
                </FormField>
                <FormField label="Offset Y (px)">
                  <Input
                    type="number"
                    value={form.offsetY}
                    onChange={(v) => set("offsetY", v)}
                  />
                </FormField>
              </div>

              {/* Advanced JSON */}
              <FormField
                label="Zones d'exclusion avancées (optionnel)"
                help={'Format JSON : { "excludeZones": [], "excludeSlotIds": [] }'}
                error={errors.advancedJson}
              >
                <Textarea
                  value={form.advancedJson}
                  onChange={handleAdvancedChange}
                  placeholder={'{\n  "excludeZones": [],\n  "excludeSlotIds": []\n}'}
                  rows={4}
                  error={errors.advancedJson}
                />
              </FormField>

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
              {isEdit ? "Mettre à jour" : "Créer"}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
