"use client";

/**
 * Checkbox — case à cocher Liquid Glass.
 *
 * Doctrine Liquid Glass v2 :
 * - Unchecked : carré semi-verre — gradient blanc + ring inset signature
 *   subtle + ombre proche. Ressemble à un mini bouton glass.
 * - Checked : gradient liquid graphite (gray-700 → gray-900) — cohérent
 *   Button primary, signature dark autoritaire.
 * - Indeterminate : trait horizontal au centre (Minus).
 * - Hover : ring inset renforcé.
 * - Focus : focus-ring mono dark.
 *
 * Remplace les `<input type="checkbox">` natives partout (AssetCard, Table,
 * forms admin) pour la cohérence visuelle.
 *
 * API contrôlée : `checked` (boolean | "indeterminate") + `onChange(boolean)`.
 */

import { Check, Minus } from "lucide-react";
import { forwardRef } from "react";

interface CheckboxProps {
  checked: boolean | "indeterminate";
  onChange: (checked: boolean) => void;
  size?: "sm" | "md";
  disabled?: boolean;
  /** Label sr-only obligatoire pour l'a11y. */
  label?: string;
  className?: string;
}

export const Checkbox = forwardRef<HTMLButtonElement, CheckboxProps>(function Checkbox(
  { checked, onChange, size = "md", disabled = false, label, className },
  ref,
) {
  const sizeCls = size === "sm" ? "h-4 w-4" : "h-5 w-5";
  const iconSize = size === "sm" ? 10 : 12;

  const isChecked = checked === true;
  const isIndeterminate = checked === "indeterminate";
  const isActive = isChecked || isIndeterminate;

  return (
    <button
      ref={ref}
      type="button"
      role="checkbox"
      aria-checked={isIndeterminate ? "mixed" : isChecked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!isChecked);
      }}
      className={[
        "inline-flex items-center justify-center rounded-md transition-all focus-ring shrink-0",
        sizeCls,
        isActive
          ? // Checked / indeterminate : gradient liquid graphite (Button primary).
            "bg-gradient-to-b from-gray-700 to-gray-900 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),inset_0_0_0_1px_rgba(255,255,255,0.04),inset_0_-1px_0_rgba(0,0,0,0.18),0_1px_2px_rgba(15,23,42,0.12),0_4px_8px_-4px_rgba(15,23,42,0.18)] hover:from-gray-600 hover:to-gray-800 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.28),inset_0_-1px_0_rgba(0,0,0,0.2),0_2px_4px_rgba(15,23,42,0.14),0_6px_12px_-4px_rgba(15,23,42,0.22)]"
          : // Unchecked : glass blanc subtil.
            "bg-gradient-to-b from-white/90 to-white/65 backdrop-blur-[8px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.14),inset_0_-1px_0_rgba(15,23,42,0.06),0_1px_2px_rgba(15,23,42,0.04)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.22),0_2px_4px_rgba(15,23,42,0.06)]",
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
        className ?? "",
      ].filter(Boolean).join(" ")}
    >
      {isChecked && <Check size={iconSize} strokeWidth={2.8} aria-hidden />}
      {isIndeterminate && <Minus size={iconSize} strokeWidth={2.8} aria-hidden />}
    </button>
  );
});
