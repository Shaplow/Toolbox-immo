"use client";

/**
 * PatternBindingForm — formulaire d'édition d'un PatternBinding (liaison
 * compte ↔ recette globale).
 *
 * 6 champs minimaux par défaut (label custom, planning, assignations).
 * Section "Surcharger cette recette pour ce compte" repliée par défaut pour
 * exposer les overrides optionnels (preset captions/prompt description/cover).
 */

import { useState } from "react";
import { Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { Combobox } from "@/components/ui/Combobox";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { TimePicker } from "@/components/ui/TimePicker";

const DAYS = [
  { value: 1, label: "Lun" },
  { value: 2, label: "Mar" },
  { value: 3, label: "Mer" },
  { value: 4, label: "Jeu" },
  { value: 5, label: "Ven" },
  { value: 6, label: "Sam" },
  { value: 7, label: "Dim" },
];

const COVER_OVERRIDE_OPTIONS = [
  { value: "", label: "Hérite de la recette" },
  { value: "none", label: "Pas de cover" },
  { value: "manualSelect", label: "Sélection libre (CM)" },
  { value: "autoPack", label: "Pack auto → sélection" },
  { value: "monteurUpload", label: "Upload par le monteur" },
];

export interface PatternBindingFormInitial {
  id: string;
  patternTemplateId: string;
  templateLabel: string;
  customLabel: string | null;
  dayOfWeek: number[];
  publishTime: string;
  isActive: boolean;
}

export interface PatternBindingFormValues {
  customLabel: string | null;
  dayOfWeek: number[];
  publishTime: string;
  isActive: boolean;
  defaultAssigneeMonteurId: string | null;
  defaultAssigneeCmId: string | null;
  defaultAssigneeVideasteId: string | null;
  templateIdOverride: string | null;
  captionPresetIdOverride: string | null;
  descriptionPromptIdOverride: string | null;
  coverModeOverride: string | null;
}

interface PatternBindingFormProps {
  initial: PatternBindingFormInitial;
  isCreating: boolean;
  monteurs: { id: string; name: string }[];
  cms: { id: string; name: string }[];
  videastes: { id: string; name: string }[];
  captionPresets: { id: string; name: string }[];
  descriptionPrompts: { id: string; name: string }[];
  saving: boolean;
  onSave: (values: PatternBindingFormValues) => Promise<void> | void;
  onDelete?: () => void;
  onClose: () => void;
}

export function PatternBindingForm({
  initial,
  isCreating,
  monteurs,
  cms,
  videastes,
  captionPresets,
  descriptionPrompts,
  saving,
  onSave,
  onDelete,
  onClose,
}: PatternBindingFormProps) {
  const [customLabel, setCustomLabel] = useState(initial.customLabel ?? "");
  const [publishTime, setPublishTime] = useState(initial.publishTime);
  // Sprint A — Pré-remplir Lun-Ven en création quand initial.dayOfWeek est
  // vide (cas par défaut). L'admin peut décocher les jours qui ne s'appliquent
  // pas. Sans ce default, le binding est créé sans planning auto et le slot
  // ne sera jamais matérialisé par le cron.
  const [dayOfWeek, setDayOfWeek] = useState<number[]>(
    isCreating && initial.dayOfWeek.length === 0
      ? [1, 2, 3, 4, 5]
      : initial.dayOfWeek,
  );
  const [isActive, setIsActive] = useState(initial.isActive);
  const [monteurId, setMonteurId] = useState<string>("");
  const [cmId, setCmId] = useState<string>("");
  const [videasteId, setVideasteId] = useState<string>("");
  const [captionPresetOverride, setCaptionPresetOverride] = useState<string>("");
  const [descriptionPromptOverride, setDescriptionPromptOverride] = useState<string>("");
  const [coverModeOverride, setCoverModeOverride] = useState<string>("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleDay(d: number) {
    setDayOfWeek((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort(),
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!publishTime) {
      setError("L'heure de publication est requise.");
      return;
    }
    void onSave({
      customLabel: customLabel.trim() || null,
      dayOfWeek,
      publishTime,
      isActive,
      defaultAssigneeMonteurId: monteurId || null,
      defaultAssigneeCmId: cmId || null,
      defaultAssigneeVideasteId: videasteId || null,
      templateIdOverride: null,
      captionPresetIdOverride: captionPresetOverride || null,
      descriptionPromptIdOverride: descriptionPromptOverride || null,
      coverModeOverride: coverModeOverride || null,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-full">
      <ConfirmDialog
        open={confirmDelete}
        title="Supprimer cette liaison ?"
        description="La recette reste dans le catalogue, seule la liaison à ce compte est supprimée. Les slots historiques restent rattachables via leur patternId legacy."
        confirmLabel="Supprimer"
        variant="danger"
        loading={saving}
        onConfirm={() => {
          setConfirmDelete(false);
          if (onDelete) onDelete();
        }}
        onCancel={() => setConfirmDelete(false)}
      />

      <header className="shrink-0 px-5 pt-5 pb-3 border-b border-white/30">
        <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">
          {isCreating ? "Lier une recette" : "Édition liaison"}
        </p>
        <h2 className="mt-1 text-[18px] font-semibold tracking-tight text-gray-950">
          {customLabel.trim() || initial.templateLabel}
        </h2>
        <p className="mt-0.5 text-[11.5px] text-gray-500">
          Recette : <span className="font-medium">{initial.templateLabel}</span>
        </p>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
        {/* Identité (label custom, isActive) */}
        <section className="space-y-3">
          <h3 className="text-[10px] uppercase tracking-widest font-semibold text-gray-700">
            Identité
          </h3>
          <FormField
            label="Label custom"
            help="Optionnel. Hérite du label de la recette si vide."
          >
            <Input
              value={customLabel}
              onChange={setCustomLabel}
              placeholder={initial.templateLabel}
            />
          </FormField>
          <label className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-white/40 transition-colors cursor-pointer">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-sky-600"
            />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-gray-900">Liaison active</p>
              <p className="text-[11px] text-gray-500 mt-0.5">
                Quand désactivée, le cron ignore cette liaison à la génération.
              </p>
            </div>
          </label>
        </section>

        {/* Planning */}
        <section className="space-y-3 pt-4 border-t border-white/40">
          <h3 className="text-[10px] uppercase tracking-widest font-semibold text-gray-700">
            Planning
          </h3>
          <FormField label="Heure de publication" required>
            <TimePicker value={publishTime} onChange={setPublishTime} />
          </FormField>
          <FormField
            label="Jours auto-générés"
            help={
              dayOfWeek.length === 0
                ? "Aucun jour sélectionné : aucune génération auto. Les slots devront être créés manuellement."
                : undefined
            }
          >
            <div className="inline-flex gap-1.5 flex-wrap">
              {DAYS.map((d) => {
                const active = dayOfWeek.includes(d.value);
                return (
                  <button
                    type="button"
                    key={d.value}
                    onClick={() => toggleDay(d.value)}
                    className={`h-8 px-3 rounded-md text-[12px] font-medium transition-all ${
                      active
                        ? "bg-gray-900 text-white shadow-[0_1px_2px_rgba(15,23,42,0.12)]"
                        : "bg-white/55 text-gray-600 hover:bg-white/85 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08)]"
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </FormField>
        </section>

        {/* Équipe */}
        <section className="space-y-3 pt-4 border-t border-white/40">
          <h3 className="text-[10px] uppercase tracking-widest font-semibold text-gray-700">
            Équipe par défaut
          </h3>
          <FormField label="Vidéaste">
            <Combobox
              value={videasteId}
              onChange={setVideasteId}
              options={[
                { value: "", label: "— Aucun —" },
                ...videastes.map((u) => ({ value: u.id, label: u.name })),
              ]}
            />
          </FormField>
          <FormField label="Monteur">
            <Combobox
              value={monteurId}
              onChange={setMonteurId}
              options={[
                { value: "", label: "— Aucun —" },
                ...monteurs.map((u) => ({ value: u.id, label: u.name })),
              ]}
            />
          </FormField>
          <FormField label="Community manager">
            <Combobox
              value={cmId}
              onChange={setCmId}
              options={[
                { value: "", label: "— Aucun —" },
                ...cms.map((u) => ({ value: u.id, label: u.name })),
              ]}
            />
          </FormField>
        </section>

        {/* Overrides (rare, replié par défaut) */}
        <CollapsibleSection
          title="Surcharger cette recette pour ce compte"
          defaultOpen={false}
          storageKey={`binding-form:${initial.id || "new"}:overrides`}
        >
          <p className="text-[11px] text-gray-500 mb-2">
            Optionnel. Permet de dévier la recette pour ce compte uniquement.
            La majorité des comptes laissent ces champs hérités.
          </p>
          <div className="space-y-3 pt-1">
            <FormField label="Preset captions (override)">
              <Combobox
                value={captionPresetOverride}
                onChange={setCaptionPresetOverride}
                options={[
                  { value: "", label: "Hérite de la recette" },
                  ...captionPresets.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
            </FormField>
            <FormField label="Prompt description (override)">
              <Combobox
                value={descriptionPromptOverride}
                onChange={setDescriptionPromptOverride}
                options={[
                  { value: "", label: "Hérite de la recette" },
                  ...descriptionPrompts.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
            </FormField>
            <FormField label="Mode cover (override)">
              <Combobox
                value={coverModeOverride}
                onChange={setCoverModeOverride}
                options={COVER_OVERRIDE_OPTIONS}
              />
            </FormField>
          </div>
        </CollapsibleSection>

        {error && <p className="text-[12px] text-rose-700">{error}</p>}
      </div>

      <footer className="shrink-0 flex items-center justify-between gap-2 px-5 py-3 bg-white/30 border-t border-white/30">
        {onDelete ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon={Trash2}
            onClick={() => setConfirmDelete(true)}
          >
            Supprimer la liaison
          </Button>
        ) : (
          <span />
        )}
        <div className="inline-flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Annuler
          </Button>
          <Button type="submit" variant="primary" size="sm" icon={Save} loading={saving}>
            {isCreating ? "Lier la recette" : "Enregistrer"}
          </Button>
        </div>
      </footer>
    </form>
  );
}
