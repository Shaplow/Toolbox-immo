"use client";

/**
 * CoverPresetEditDialog — refonte UX (Phase 4 Cohérence Workflows).
 *
 * Avant : modal verticale étroite avec un JSON brut pour les zones d'exclusion,
 * aucun preview du résultat, jargon technique exposé tel quel à l'admin.
 *
 * Maintenant : modal 2 colonnes (preview live + controls visuels).
 *  - Colonne gauche : CoverPresetThumbnail en grand (canvas SVG ratio 9:16)
 *    montre les overlay groups sélectionnés + les zones d'exclusion en temps réel.
 *  - Colonne droite : controls organisés en 3 sections (Identité, Composition,
 *    Zones d'exclusion). Plus de Textarea JSON — les zones sont éditées via
 *    une liste de petits formulaires (x/y/w/h avec stepper) + bouton "+".
 */

import { useEffect, useRef, useState } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { toast } from "@/components/ui/Toast";
import type { CoverPresetRow } from "./CoverPresetsPanel";
import { CoverPresetThumbnail } from "./CoverPresetThumbnail";
import type { TemplateJSON } from "@/types/template";

// ─── Types ────────────────────────────────────────────────────────────────────

type TemplateGroup = { id: string; name: string };

interface ExcludeZone {
  x: number;
  y: number;
  w: number;
  h: number;
}

type FormState = {
  name: string;
  sortOrder: string;
  enabled: boolean;
  frameCount: number;
  overlayGroupIds: string[];
  offsetX: string;
  offsetY: string;
  excludeZones: ExcludeZone[];
  excludeSlotIds: string[];
};

type Props = {
  templateId: string;
  preset?: CoverPresetRow | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function defaultForm(preset?: CoverPresetRow | null): FormState {
  if (!preset) {
    return {
      name: "",
      sortOrder: "0",
      enabled: true,
      frameCount: 36,
      overlayGroupIds: [],
      offsetX: "0",
      offsetY: "0",
      excludeZones: [],
      excludeSlotIds: [],
    };
  }
  const c = preset.config;
  return {
    name: preset.name,
    sortOrder: String(preset.sortOrder),
    enabled: typeof c.enabled === "boolean" ? c.enabled : true,
    frameCount: typeof c.frameCount === "number" ? c.frameCount : 36,
    overlayGroupIds: Array.isArray(c.overlayGroupIds) ? (c.overlayGroupIds as string[]) : [],
    offsetX: String(typeof c.offsetX === "number" ? c.offsetX : 0),
    offsetY: String(typeof c.offsetY === "number" ? c.offsetY : 0),
    excludeZones: Array.isArray(c.excludeZones) ? (c.excludeZones as ExcludeZone[]) : [],
    excludeSlotIds: Array.isArray(c.excludeSlotIds) ? (c.excludeSlotIds as string[]) : [],
  };
}

// ─── Composant ────────────────────────────────────────────────────────────────

export function CoverPresetEditDialog({ templateId, preset, open, onClose, onSaved }: Props) {
  const isEdit = !!preset;
  const [form, setForm] = useState<FormState>(() => defaultForm(preset));
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [loading, setLoading] = useState(false);

  const [template, setTemplate] = useState<TemplateJSON | null>(null);
  const [groups, setGroups] = useState<TemplateGroup[]>([]);
  const [videoSlots, setVideoSlots] = useState<{ id: string; label: string }[]>([]);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Re-init form when preset/open change
  useEffect(() => {
    setForm(defaultForm(preset));
    setErrors({});
  }, [preset, open]);

  // Fetch template (canvas + blocks + groups) pour le preview live
  useEffect(() => {
    if (!open || !templateId) return;
    let cancelled = false;
    void fetch(`/api/templates/${templateId}`)
      .then((r) =>
        r.ok ? (r.json() as Promise<{ jsonData: string; groups?: TemplateGroup[] }>) : null,
      )
      .then((data) => {
        if (cancelled || !data) return;
        try {
          const parsed = JSON.parse(data.jsonData) as TemplateJSON;
          setTemplate(parsed);
          // Slots vidéo (pour exclureSlotIds)
          const slots = (parsed.videoSequence ?? []).map((s, idx) => ({
            id: s.id,
            label: s.label ?? `Slot ${idx + 1}`,
          }));
          setVideoSlots(slots);
        } catch {
          // ignore parse errors
        }
        setGroups(data.groups ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [templateId, open]);

  // ESC pour fermer
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function toggleOverlayGroup(groupId: string, checked: boolean) {
    set(
      "overlayGroupIds",
      checked
        ? [...form.overlayGroupIds, groupId]
        : form.overlayGroupIds.filter((id) => id !== groupId),
    );
  }

  function toggleSlot(slotId: string, checked: boolean) {
    set(
      "excludeSlotIds",
      checked
        ? [...form.excludeSlotIds, slotId]
        : form.excludeSlotIds.filter((id) => id !== slotId),
    );
  }

  function addExcludeZone() {
    // Zone par défaut au centre, 200×200 px (suffisamment visible sur le canvas)
    const cw = template?.canvas?.width ?? 1080;
    const ch = template?.canvas?.height ?? 1920;
    const w = Math.min(200, Math.round(cw / 3));
    const h = Math.min(200, Math.round(ch / 3));
    const x = Math.round((cw - w) / 2);
    const y = Math.round((ch - h) / 2);
    set("excludeZones", [...form.excludeZones, { x, y, w, h }]);
  }

  function updateExcludeZone(index: number, partial: Partial<ExcludeZone>) {
    const next = form.excludeZones.map((z, i) => (i === index ? { ...z, ...partial } : z));
    set("excludeZones", next);
  }

  function removeExcludeZone(index: number) {
    set(
      "excludeZones",
      form.excludeZones.filter((_, i) => i !== index),
    );
  }

  function buildConfig(): Record<string, unknown> {
    return {
      enabled: form.enabled,
      frameCount: Math.min(72, Math.max(6, form.frameCount)),
      overlayGroupIds: form.overlayGroupIds,
      offsetX: parseInt(form.offsetX, 10) || 0,
      offsetY: parseInt(form.offsetY, 10) || 0,
      excludeZones: form.excludeZones,
      excludeSlotIds: form.excludeSlotIds,
    };
  }

  function validate(): boolean {
    const newErrors: Partial<Record<keyof FormState, string>> = {};
    if (!form.name.trim()) newErrors.name = "Le nom est requis";
    if (form.name.trim().length > 100) newErrors.name = "Maximum 100 caractères";
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
        const data = (await res.json()) as { error?: string };
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

  // Config "live" pour le preview (reflète l'état du form en temps réel)
  const previewConfig = {
    overlayGroupIds: form.overlayGroupIds,
    excludeZones: form.excludeZones,
    offsetX: parseInt(form.offsetX, 10) || 0,
    offsetY: parseInt(form.offsetY, 10) || 0,
  };

  return (
    <>
      {/* Overlay */}
      <div
        ref={overlayRef}
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal — plus large (max-w-4xl) pour le layout 2 colonnes */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cover-preset-dialog-title"
        className="fixed inset-0 z-50 flex items-center justify-center px-4 pointer-events-none"
      >
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl pointer-events-auto overflow-hidden flex flex-col max-h-[90vh]">
          {/* Header */}
          <div className="px-6 pt-5 pb-4 border-b border-gray-100 flex items-center justify-between shrink-0">
            <div>
              <h2 id="cover-preset-dialog-title" className="text-base font-semibold text-gray-900">
                {isEdit ? "Modifier le preset cover" : "Nouveau preset cover"}
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Configure visuellement les zones, overlays et offsets pour ce preset.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Fermer"
            >
              <X size={18} />
            </button>
          </div>

          {/* Body 2 colonnes */}
          <form
            onSubmit={(e) => void handleSubmit(e)}
            className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-[280px_1fr]"
          >
            {/* ── Colonne gauche : Preview live ──────────────────────────── */}
            <div className="bg-gray-50 border-r border-gray-100 p-5 flex flex-col items-center gap-3 overflow-y-auto">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide self-start">
                Aperçu
              </p>
              {template ? (
                <CoverPresetThumbnail
                  template={template}
                  config={previewConfig}
                  width={240}
                />
              ) : (
                <div
                  className="bg-gray-200 rounded animate-pulse"
                  style={{ width: 240, aspectRatio: "9 / 16" }}
                />
              )}
              <div className="text-[11px] text-gray-500 self-start space-y-1">
                <p className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded bg-indigo-400 opacity-60 border border-indigo-500" />
                  Overlay groups sélectionnés
                </p>
                <p className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded bg-red-200 border border-red-400 border-dashed" />
                  Zones d&apos;exclusion (frames évitées)
                </p>
              </div>
            </div>

            {/* ── Colonne droite : Controls ─────────────────────────────── */}
            <div className="overflow-y-auto px-6 py-5 flex flex-col gap-5">
              {/* Section Identité */}
              <section className="space-y-3">
                <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                  Identité
                </h3>
                <FormField label="Nom" required error={errors.name}>
                  <Input
                    value={form.name}
                    onChange={(v) => set("name", v)}
                    maxLength={100}
                    placeholder="Ex : Standard, Minimal, Vibrant…"
                    error={errors.name}
                  />
                </FormField>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Ordre" help="Plus petit = en haut.">
                    <Input
                      type="number"
                      value={form.sortOrder}
                      onChange={(v) => set("sortOrder", v)}
                    />
                  </FormField>
                  <label className="flex items-end gap-3 cursor-pointer pb-1">
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={form.enabled}
                        onChange={(e) => set("enabled", e.target.checked)}
                        className="sr-only"
                      />
                      <div
                        className={`w-9 h-5 rounded-full transition-colors ${
                          form.enabled ? "bg-indigo-600" : "bg-gray-200"
                        }`}
                      />
                      <div
                        className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                          form.enabled ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </div>
                    <span className="text-sm text-gray-700">Activé</span>
                  </label>
                </div>
              </section>

              {/* Section Composition */}
              <section className="space-y-3">
                <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                  Composition
                </h3>

                {/* frameCount — slider visuel + valeur affichée */}
                <FormField
                  label={`Nombre de frames proposées : ${form.frameCount}`}
                  help="Le CM choisira parmi ces N frames extraites de la vidéo."
                >
                  <input
                    type="range"
                    min={6}
                    max={72}
                    step={1}
                    value={form.frameCount}
                    onChange={(e) => set("frameCount", parseInt(e.target.value, 10))}
                    className="w-full accent-indigo-600"
                  />
                  <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
                    <span>6</span>
                    <span>72</span>
                  </div>
                </FormField>

                {/* Overlay groups */}
                <FormField
                  label="Groupes d'overlay"
                  help="Éléments du template superposés sur la frame sélectionnée (texte, logo, badge…)."
                >
                  {groups.length === 0 ? (
                    <p className="text-xs text-gray-400 italic">
                      Aucun groupe défini dans ce template.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2 mt-1">
                      {groups.map((g) => {
                        const isSel = form.overlayGroupIds.includes(g.id);
                        return (
                          <label
                            key={g.id}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs cursor-pointer transition-colors ${
                              isSel
                                ? "bg-indigo-50 border-indigo-300 text-indigo-700 font-medium"
                                : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSel}
                              onChange={(e) => toggleOverlayGroup(g.id, e.target.checked)}
                              className="sr-only"
                            />
                            {g.name}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </FormField>

                {/* Offsets X/Y */}
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
              </section>

              {/* Section Exclusions */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                    Zones d&apos;exclusion
                  </h3>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    icon={Plus}
                    onClick={addExcludeZone}
                  >
                    Ajouter une zone
                  </Button>
                </div>
                <p className="text-xs text-gray-500">
                  Rectangles à éviter pour l&apos;extraction des frames (logos, textes
                  qui changent, etc.). Coordonnées en pixels (canvas {template?.canvas?.width ?? 1080}×{template?.canvas?.height ?? 1920}).
                </p>

                {form.excludeZones.length === 0 ? (
                  <p className="text-xs text-gray-400 italic bg-gray-50 rounded-lg px-3 py-2">
                    Aucune zone d&apos;exclusion. Cliquez sur « Ajouter une zone » pour en créer.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {form.excludeZones.map((zone, i) => (
                      <li
                        key={i}
                        className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-1.5 items-center bg-red-50/30 border border-red-100 rounded-lg p-2"
                      >
                        <label className="block">
                          <span className="text-[10px] text-red-700 font-medium">X</span>
                          <input
                            type="number"
                            value={zone.x}
                            onChange={(e) =>
                              updateExcludeZone(i, { x: parseInt(e.target.value, 10) || 0 })
                            }
                            className="w-full px-1.5 py-1 text-xs border border-red-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-red-300"
                          />
                        </label>
                        <label className="block">
                          <span className="text-[10px] text-red-700 font-medium">Y</span>
                          <input
                            type="number"
                            value={zone.y}
                            onChange={(e) =>
                              updateExcludeZone(i, { y: parseInt(e.target.value, 10) || 0 })
                            }
                            className="w-full px-1.5 py-1 text-xs border border-red-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-red-300"
                          />
                        </label>
                        <label className="block">
                          <span className="text-[10px] text-red-700 font-medium">Largeur</span>
                          <input
                            type="number"
                            value={zone.w}
                            onChange={(e) =>
                              updateExcludeZone(i, { w: parseInt(e.target.value, 10) || 0 })
                            }
                            className="w-full px-1.5 py-1 text-xs border border-red-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-red-300"
                          />
                        </label>
                        <label className="block">
                          <span className="text-[10px] text-red-700 font-medium">Hauteur</span>
                          <input
                            type="number"
                            value={zone.h}
                            onChange={(e) =>
                              updateExcludeZone(i, { h: parseInt(e.target.value, 10) || 0 })
                            }
                            className="w-full px-1.5 py-1 text-xs border border-red-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-red-300"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => removeExcludeZone(i)}
                          className="p-1 text-red-600 hover:bg-red-100 rounded transition-colors mt-3"
                          aria-label={`Supprimer la zone ${i + 1}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Slots vidéo exclus (si template a videoSequence) */}
                {videoSlots.length > 0 && (
                  <FormField
                    label="Slots vidéo exclus"
                    help="Slots du template à ignorer pour l'extraction (ex: intro/outro)."
                  >
                    <div className="flex flex-wrap gap-2 mt-1">
                      {videoSlots.map((s) => {
                        const isSel = form.excludeSlotIds.includes(s.id);
                        return (
                          <label
                            key={s.id}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs cursor-pointer transition-colors ${
                              isSel
                                ? "bg-red-50 border-red-300 text-red-700 font-medium"
                                : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSel}
                              onChange={(e) => toggleSlot(s.id, e.target.checked)}
                              className="sr-only"
                            />
                            {s.label}
                          </label>
                        );
                      })}
                    </div>
                  </FormField>
                )}
              </section>
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
