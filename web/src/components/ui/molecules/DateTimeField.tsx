"use client";

/**
 * DateTimeField — DatePicker + TimePicker combinés sur une valeur
 * `datetime-local` ("YYYY-MM-DDTHH:MM", "" = vide).
 *
 * Remplace les `<input type="datetime-local">` natifs (rendu navigateur
 * incohérent avec la DA) — V3.2, premiers consommateurs : EntityFiche,
 * CreateEntityModal, AttachSlotModal.
 *
 * Comportement : choisir une date sans heure applique `defaultTime` ; l'heure
 * est désactivée tant qu'aucune date n'est choisie ; vider la date vide tout.
 */

import { DatePicker } from "@/components/ui/DatePicker";
import { TimePicker } from "@/components/ui/TimePicker";

interface DateTimeFieldProps {
  /** "YYYY-MM-DDTHH:MM" ou "". */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Heure appliquée quand on choisit une date sans heure. Défaut "09:00". */
  defaultTime?: string;
}

export function DateTimeField({
  value,
  onChange,
  disabled = false,
  defaultTime = "09:00",
}: DateTimeFieldProps) {
  const datePart = value.slice(0, 10);
  const timePart = value.slice(11, 16);

  return (
    <div className="grid grid-cols-[1fr_auto] gap-2">
      <DatePicker
        value={datePart}
        onChange={(d) => onChange(d ? `${d}T${timePart || defaultTime}` : "")}
        disabled={disabled}
      />
      <TimePicker
        value={timePart}
        onChange={(t) => onChange(datePart ? `${datePart}T${t}` : "")}
        disabled={disabled || !datePart}
      />
    </div>
  );
}
