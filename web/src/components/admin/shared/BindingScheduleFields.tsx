"use client";

/**
 * BindingScheduleFields — heure de publication, jours auto-générés et trio
 * d'assignées par défaut (vidéaste/monteur/CM), partagés entre RecipeForm
 * (onglet Planning) et DeployTemplateModal. Avant cette extraction, les deux
 * dupliquaient ce bloc avec des primitives différentes (Input type="time" vs
 * TimePicker, boutons jour ad hoc avec labels redéclarés).
 */

import { Combobox } from "@/components/ui/Combobox";
import { FormField } from "@/components/ui/FormField";
import { TimePicker } from "@/components/ui/TimePicker";
import { DayOfWeekPicker } from "@/components/admin/shared/DayOfWeekPicker";

export interface AssigneeOption {
  id: string;
  name: string;
}

export interface BindingScheduleValues {
  publishTime: string;
  dayOfWeek: number[];
  monteurId: string;
  cmId: string;
  videasteId: string;
}

interface BindingScheduleFieldsProps {
  values: BindingScheduleValues;
  onChange: (patch: Partial<BindingScheduleValues>) => void;
  monteurs: AssigneeOption[];
  cms: AssigneeOption[];
  videastes: AssigneeOption[];
  dayOfWeekHelp?: string;
}

export function BindingScheduleFields({
  values: v,
  onChange,
  monteurs,
  cms,
  videastes,
  dayOfWeekHelp,
}: BindingScheduleFieldsProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField label="Heure de publication" required>
          <TimePicker value={v.publishTime} onChange={(val) => onChange({ publishTime: val })} />
        </FormField>
        <FormField label="Jours auto-générés" help={dayOfWeekHelp}>
          <DayOfWeekPicker
            value={v.dayOfWeek}
            onChange={(val) => onChange({ dayOfWeek: val })}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <FormField label="Vidéaste défaut">
          <Combobox
            value={v.videasteId}
            onChange={(val) => onChange({ videasteId: val })}
            options={[
              { value: "", label: "— Aucun —" },
              ...videastes.map((u) => ({ value: u.id, label: u.name })),
            ]}
          />
        </FormField>
        <FormField label="Monteur défaut">
          <Combobox
            value={v.monteurId}
            onChange={(val) => onChange({ monteurId: val })}
            options={[
              { value: "", label: "— Aucun —" },
              ...monteurs.map((u) => ({ value: u.id, label: u.name })),
            ]}
          />
        </FormField>
        <FormField label="CM défaut">
          <Combobox
            value={v.cmId}
            onChange={(val) => onChange({ cmId: val })}
            options={[
              { value: "", label: "— Aucun —" },
              ...cms.map((u) => ({ value: u.id, label: u.name })),
            ]}
          />
        </FormField>
      </div>
    </div>
  );
}
