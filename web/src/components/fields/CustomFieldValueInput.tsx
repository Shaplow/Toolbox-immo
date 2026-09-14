"use client";

import { useState, type KeyboardEvent } from "react";
import type { CustomField } from "@/lib/customFields";
import {
  CHECKBOX_TRUE,
  isCheckedFieldValue,
  isNumericFieldValue,
  isPartialNumericInput,
} from "@/lib/customFields";
import { Select } from "@/components/ui/Select";
import { Checkbox } from "@/components/ui/Checkbox";

interface CustomFieldValueInputProps {
  field: CustomField;
  value: string;
  onChange: (value: string) => void;
  /** Affiche le libellé au-dessus (contexte formulaire). Sinon input « nu » (cellule tableur). */
  showLabel?: boolean;
  /** Message d'erreur affiché sous le champ (validation de formulaire). */
  error?: string;
  /**
   * Applique le contrôle de format des champs `number` (blocage à la frappe +
   * bordure d'erreur).
   *
   * OPT-IN volontaire : le composant est partagé par des surfaces dont
   * l'écriture ne passe PAS par `validateFieldValues`. Les allumer toutes
   * afficherait une erreur que le serveur n'applique pas — décorative au mieux,
   * mensongère au pire (le drawer média coerce la valeur à l'enregistrement).
   * À n'activer que là où la garde serveur correspondante existe.
   */
  validateNumberFormat?: boolean;
  /**
   * Valeur telle que stockée en base, à alimenter avec EXACTEMENT la même
   * source que `previousValues` côté serveur. Une valeur historique non
   * conforme, tant qu'elle n'est pas modifiée, est acceptée des deux côtés :
   * sans ce miroir, le champ virerait au rouge sur une donnée que le serveur
   * accepte parfaitement.
   */
  previousValue?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  onBlur?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  className?: string;
}

const CONTROL_BASE =
  "w-full rounded-md border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2";
const CONTROL_OK = "border-input focus:ring-ring/40";
const CONTROL_ERR = "border-danger-600 focus:ring-danger-600/30";

/**
 * Saisie d'une VALEUR de champ personnalisé, rendue selon son type (les 6 types
 * canoniques : text / textarea / number / url / select / checkbox). Composant
 * partagé unique — remplace les ~6 mappings type→input dupliqués (Bien,
 * mission, médiathèque, data). Valeur toujours string, `"true"` pour une case
 * cochée (cohérent avec le stockage, cf. lib/customFields).
 */
export function CustomFieldValueInput({
  field,
  value,
  onChange,
  showLabel = false,
  error,
  validateNumberFormat = false,
  previousValue,
  disabled = false,
  autoFocus = false,
  onBlur,
  onKeyDown,
  className,
}: CustomFieldValueInputProps) {
  // Message transitoire d'une frappe refusée : sans retour visible, un
  // caractère qui ne s'inscrit pas passe pour un clavier cassé.
  const [blocked, setBlocked] = useState<string | null>(null);

  const checksNumber = validateNumberFormat && field.type === "number";
  const trimmed = value.trim();
  // Une valeur héritée non conforme reste acceptée tant qu'on n'y touche pas —
  // strictement la même règle que le serveur.
  const unchanged = previousValue !== undefined && trimmed === previousValue.trim();
  const formatError =
    checksNumber && trimmed && !unchanged && !isNumericFieldValue(trimmed)
      ? "Nombre attendu (ex : 68, 68,5 ou 1 200)"
      : null;
  const shownError = error ?? blocked ?? formatError ?? undefined;

  const control = [CONTROL_BASE, shownError ? CONTROL_ERR : CONTROL_OK, className]
    .filter(Boolean)
    .join(" ");

  const placeholder =
    field.type === "url" ? "https://…" : `Valeur pour « ${field.label || field.key} »`;

  function handleChange(next: string) {
    // Filtre de frappe : on refuse le caractère plutôt que d'accepter une
    // valeur qu'on sait déjà invalide. `isPartialNumericInput` laisse passer
    // les états intermédiaires (« », « - », « 68, ») qu'on traverse en tapant.
    if (checksNumber && !isPartialNumericInput(next)) {
      setBlocked("Ce champ n'accepte que des nombres.");
      return;
    }
    if (blocked) setBlocked(null);
    onChange(next);
  }

  const input =
    field.type === "checkbox" ? (
      <Checkbox
        checked={isCheckedFieldValue(value)}
        onChange={(next) => onChange(next ? CHECKBOX_TRUE : "")}
        disabled={disabled}
        label={field.label || field.key}
        size="sm"
      />
    ) : field.type === "select" ? (
      <Select
        value={value}
        onChange={onChange}
        // Option vide en tête pour pouvoir effacer un choix non requis.
        options={[
          ...(field.required ? [] : [{ value: "", label: "—" }]),
          ...(field.options ?? []).map((o) => ({ value: o, label: o })),
        ]}
        placeholder="Choisir…"
        disabled={disabled}
        className={className}
      />
    ) : field.type === "textarea" ? (
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
        // PAS `type="number"` : selon la locale, Chrome et Firefox renvoient
        // "" pour « 68,5 » — la valeur serait silencieusement perdue, alors que
        // la virgule décimale est justement acceptée ici. S'y ajoutent la
        // molette qui incrémente au scroll et l'impossibilité de distinguer
        // vide d'invalide. Le contrôle est fait au-dessus, pas par le widget.
        type={field.type === "url" ? "url" : "text"}
        inputMode={field.type === "number" ? "decimal" : undefined}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-invalid={shownError ? true : undefined}
        placeholder={placeholder}
        className={control}
      />
    );

  // L'erreur doit être lisible AUSSI en mode cellule nue : un `return input`
  // anticipé rendait la prop `error` inopérante hors formulaire.
  if (!showLabel) {
    // En cellule nue il n'y a pas la place d'un texte d'aide : il passe en
    // `title` plutôt que d'être perdu.
    const bare =
      field.description && field.type !== "checkbox" ? (
        <span title={field.description} className="block">
          {input}
        </span>
      ) : (
        input
      );
    return shownError ? (
      <div className="flex flex-col gap-1">
        {bare}
        <span className="text-[11px] text-danger-600">{shownError}</span>
      </div>
    ) : (
      bare
    );
  }

  const help = field.description ? (
    <span className="text-[11px] text-muted-foreground">{field.description}</span>
  ) : null;

  // Une case à cocher se lit « case puis libellé », pas « libellé au-dessus » :
  // la structure verticale des autres types la rendrait orpheline de son sens.
  if (field.type === "checkbox") {
    return (
      <div className="flex flex-col gap-1">
        <label className="flex items-start gap-2 cursor-pointer">
          {input}
          <span className="flex flex-col gap-0.5 -mt-0.5">
            <span className="text-[13px] text-foreground">
              {field.label || field.key}
              {field.required && <span className="text-danger-600"> •</span>}
            </span>
            {help}
          </span>
        </label>
        {shownError && <span className="text-[11px] text-danger-600">{shownError}</span>}
      </div>
    );
  }

  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {field.label || field.key}
        {field.required && <span className="text-danger-600"> •</span>}
      </span>
      {help}
      {input}
      {shownError && <span className="text-[11px] text-danger-600">{shownError}</span>}
    </label>
  );
}
