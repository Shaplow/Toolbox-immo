"use client";

import type { KeyboardEvent } from "react";
import type { CustomField } from "@/lib/customFields";

interface CustomFieldValueInputProps {
  field: CustomField;
  value: string;
  onChange: (value: string) => void;
  /** Affiche le libellé au-dessus (contexte formulaire). Sinon input « nu » (cellule tableur). */
  showLabel?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  onBlur?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  className?: string;
}

const CONTROL =
  "w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40";

/**
 * Saisie d'une VALEUR de champ personnalisé, rendue selon son type (les 4 types
 * canoniques : text / textarea / number / url). Composant partagé unique —
 * remplace les ~6 mappings type→input dupliqués (Bien, mission, médiathèque,
 * data). Valeur toujours string (cohérent avec le stockage).
 */
export function CustomFieldValueInput({
  field,
  value,
  onChange,
  showLabel = false,
  disabled = false,
  autoFocus = false,
  onBlur,
  onKeyDown,
  className,
}: CustomFieldValueInputProps) {
  const control = className ? `${CONTROL} ${className}` : CONTROL;
  const placeholder =
    field.type === "url" ? "https://…" : `Valeur pour « ${field.label || field.key} »`;

  const input =
    field.type === "textarea" ? (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        disabled={disabled}
        autoFocus={autoFocus}
        rows={3}
        placeholder={placeholder}
        className={control}
      />
    ) : (
      <input
        type={field.type === "url" ? "url" : "text"}
        inputMode={field.type === "number" ? "decimal" : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={placeholder}
        className={control}
      />
    );

  if (!showLabel) return input;

  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {field.label || field.key}
        {field.required && <span className="text-danger-600"> •</span>}
      </span>
      {input}
    </label>
  );
}
