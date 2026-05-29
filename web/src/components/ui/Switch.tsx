"use client";

import type { ReactNode } from "react";

/**
 * Switch (toggle) — pattern Linear / Vercel.
 *
 * - Track gray-200 off → gray-950 on. Thumb white avec shadow subtle.
 * - Animation slide + scale au hover.
 * - Sizes : sm (w-7 h-4) | md (w-9 h-5, default).
 * - API contrôlée : `checked` + `onChange(checked: boolean)`.
 * - `label?` optionnel à côté (rend le whole-thing un label cliquable).
 * - `description?` sous le label (Geist text-[11px] gray-500).
 * - `accent?: "default" | "sage"` (Liquid Glass v2) — `sage` rend la
 *   track on en sage doux au lieu du graphite. Pour switches "positif
 *   calme" (preferences, opt-in). Défaut "default" inchangé.
 */

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: string;
  size?: "sm" | "md";
  disabled?: boolean;
  accent?: "default" | "sage";
  className?: string;
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  size = "md",
  disabled = false,
  accent = "default",
  className,
}: SwitchProps) {
  const trackSize = size === "sm" ? "w-7 h-4" : "w-9 h-5";
  const thumbSize = size === "sm" ? "h-3 w-3" : "h-4 w-4";
  const thumbTranslate = size === "sm" ? "translate-x-3" : "translate-x-4";

  // ON = aligné avec Button primary (liquid graphite) ou accent sage.
  const onClass =
    accent === "sage"
      ? "bg-gradient-to-b from-sage-500 to-sage-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.32),inset_0_0_0_1px_rgba(255,255,255,0.08),inset_0_-1px_0_rgba(0,0,0,0.12),0_1px_2px_rgba(47,95,63,0.18)]"
      : "bg-gradient-to-b from-gray-700 to-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.22),inset_0_0_0_1px_rgba(255,255,255,0.06),inset_0_-1px_0_rgba(0,0,0,0.18),0_1px_2px_rgba(15,23,42,0.18)]";

  // OFF = semi-verre : track gradient blanc avec ring inset signature.
  const offClass =
    "bg-gradient-to-b from-white/85 to-white/55 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.1),inset_0_-1px_0_rgba(15,23,42,0.06)] hover:from-white hover:to-white/70 hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.14),inset_0_-1px_0_rgba(15,23,42,0.08)]";

  const toggle = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex shrink-0 items-center rounded-full transition-all focus-ring disabled:opacity-50 disabled:cursor-not-allowed ${trackSize} ${
        checked ? onClass : offClass
      }`}
    >
      {/* Thumb : gradient blanc + ring inset spéculaire + ombre proche
          forte (relief tactile). */}
      <span
        className={`absolute left-0.5 inline-block rounded-full bg-gradient-to-b from-white to-white/85 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06),inset_0_-1px_0_rgba(15,23,42,0.1),0_1px_2px_rgba(15,23,42,0.18),0_2px_4px_rgba(15,23,42,0.1)] transition-transform ${thumbSize} ${
          checked ? thumbTranslate : "translate-x-0"
        }`}
      />
    </button>
  );

  if (!label) return <span className={className}>{toggle}</span>;

  return (
    <label
      className={`inline-flex items-center gap-3 cursor-pointer ${
        disabled ? "cursor-not-allowed opacity-60" : ""
      } ${className ?? ""}`}
    >
      {toggle}
      <span className="flex flex-col">
        <span className="text-[13px] text-gray-950 font-medium leading-tight">{label}</span>
        {description && (
          <span className="text-[11px] text-gray-500 leading-tight mt-0.5">{description}</span>
        )}
      </span>
    </label>
  );
}
