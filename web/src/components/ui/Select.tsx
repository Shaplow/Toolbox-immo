"use client";

import { ChevronDown } from "lucide-react";
import type { SelectHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * Select natif stylé — wrapper du `<select>` HTML avec les tokens UI.
 *
 * Utilise l'élément natif pour l'accessibilité maximale (gestion clavier
 * complète, screen reader, keyboard nav). On stylise juste le wrapper
 * + l'apparence visuelle (chevron, padding, focus ring mono).
 *
 * Pour un menu avec icônes par option ou des items custom, utiliser
 * <DropdownMenu> à la place — c'est un composant différent.
 *
 * API alignée avec <Input> :
 * - `value` / `onChange(value: string)` contrôlés.
 * - `options: { value, label, disabled? }[]`.
 * - `icon?: LucideIcon` leading (cohérent avec Input).
 * - `placeholder?` : si value est "" et placeholder fourni, montre une
 *    option disabled "placeholder" en premier.
 * - `error?` : border + focus danger.
 */

interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value"> {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[] | ReadonlyArray<SelectOption>;
  icon?: LucideIcon;
  placeholder?: string;
  error?: string;
  /** Permet de wrapper avec son propre contenu (rare). */
  trailing?: ReactNode;
}

export function Select({
  value,
  onChange,
  options,
  icon: Icon,
  placeholder,
  error,
  trailing,
  className,
  disabled,
  ...rest
}: SelectProps) {
  const wrapperBase =
    "group/select flex items-center gap-2 w-full h-8 rounded-md border bg-white transition-colors";
  const wrapperState = error
    ? "border-danger-600 focus-within:shadow-[var(--shadow-focus-ring-danger)]"
    : "border-gray-300 hover:border-gray-400 focus-within:border-gray-400 focus-within:shadow-[var(--shadow-focus-ring)]";
  const wrapperDisabled = disabled ? "bg-gray-50 opacity-60 cursor-not-allowed" : "";

  return (
    <div className={[wrapperBase, wrapperState, wrapperDisabled, className ?? ""].filter(Boolean).join(" ")}>
      {Icon && (
        <Icon
          size={14}
          className="shrink-0 ml-2.5 text-gray-400 group-focus-within/select:text-gray-700 transition-colors"
        />
      )}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        className={`flex-1 min-w-0 bg-transparent text-[13px] text-gray-950 outline-none appearance-none cursor-pointer ${
          Icon ? "pl-0" : "pl-2.5"
        } pr-0`}
        {...rest}
      >
        {placeholder !== undefined && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>
      {trailing ? (
        <span className="shrink-0 pr-2 text-[11px] text-gray-400">{trailing}</span>
      ) : (
        <ChevronDown
          size={14}
          className="shrink-0 mr-2 text-gray-400 group-focus-within/select:text-gray-700 transition-colors pointer-events-none"
        />
      )}
    </div>
  );
}
