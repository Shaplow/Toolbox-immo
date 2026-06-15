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
        "inline-flex items-center justify-center rounded-md transition-colors focus-ring shrink-0",
        sizeCls,
        // v3 big bang DA — flat shadcn.
        isActive
          ? "bg-primary text-primary-foreground border border-primary"
          : "bg-card border border-input hover:border-primary",
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
        className ?? "",
      ].filter(Boolean).join(" ")}
    >
      {isChecked && <Check size={iconSize} strokeWidth={2.8} aria-hidden />}
      {isIndeterminate && <Minus size={iconSize} strokeWidth={2.8} aria-hidden />}
    </button>
  );
});
