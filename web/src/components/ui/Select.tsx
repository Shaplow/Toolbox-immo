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
  /** Liquid Glass v2 — transparent + halo pastel au focus. */
  variant?: "default" | "glass";
}

export function Select({
  value,
  onChange,
  options,
  icon: Icon,
  placeholder,
  error,
  trailing,
  variant = "default",
  className,
  disabled,
  ...rest
}: SelectProps) {
  const wrapperBase =
    "group/select flex items-center gap-2 w-full h-8 rounded-md transition-colors";

  // Default = semi-verre. Glass = transparent + halo sky.
  // Default = glass tinté sky (aligné Input/Textarea).
  const wrapperVariantBase =
    variant === "glass"
      ? "bg-[var(--surface-glass-medium)] backdrop-blur-[8px] backdrop-saturate-150 border border-white/40"
      : "bg-sky-50/40 backdrop-blur-[10px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),inset_0_0_0_1px_rgba(15,23,42,0.08)]";

  const wrapperState = error
    ? variant === "glass"
      ? "border-danger-600 focus-within:shadow-[var(--shadow-focus-ring-danger)]"
      : "shadow-[inset_0_1px_0_rgba(255,255,255,0.85),inset_0_0_0_1px_rgba(220,38,38,0.55),0_1px_2px_rgba(220,38,38,0.1)] focus-within:shadow-[inset_0_1px_0_rgba(255,255,255,0.85),inset_0_0_0_1px_rgba(220,38,38,0.7),0_0_0_3px_rgba(220,38,38,0.2)]"
    : variant === "glass"
      ? "hover:border-sky-200 focus-within:border-sky-300 focus-within:shadow-[0_0_0_3px_rgba(169,209,230,0.32)]"
      : "hover:bg-sky-50/55 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.85),inset_0_0_0_1px_rgba(15,23,42,0.12)] focus-within:bg-sky-50/65 focus-within:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(77,150,191,0.45),0_0_0_3px_rgba(169,209,230,0.4)]";

  const wrapperDisabled = disabled ? "opacity-60 cursor-not-allowed" : "";

  return (
    <div className={[wrapperBase, wrapperVariantBase, wrapperState, wrapperDisabled, className ?? ""].filter(Boolean).join(" ")}>
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
