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

  // v3 big bang DA — flat shadcn. La prop `accent` est ignorée (mappée
  // vers primary). Le comportement reste cohérent partout dans l'app.
  void accent;

  const onClass = "bg-primary";
  const offClass = "bg-input hover:bg-zinc-300";

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
      {/* Thumb : white + shadow simple */}
      <span
        className={`absolute left-0.5 inline-block rounded-full bg-white shadow-sm transition-transform ${thumbSize} ${
          checked ? thumbTranslate : "translate-x-0"
        }`}
      />
    </button>
  );

  if (!label) return <span className={className}>{toggle}</span>;

  // Cas simple : label sans description → inline-flex centré h-8 pour
  // s'aligner avec Input / Select / NumberStepper / Button md sur une ligne
  // form. Sans h-8, la <label> prend la hauteur du toggle (20px) et le tout
  // remonte par rapport aux autres composants.
  if (!description) {
    const heightCls = size === "sm" ? "h-7" : "h-8";
    return (
      <label
        className={`inline-flex items-center gap-3 cursor-pointer ${heightCls} ${
          disabled ? "cursor-not-allowed opacity-60" : ""
        } ${className ?? ""}`}
      >
        {toggle}
        <span className="text-[13px] text-foreground font-medium leading-none">{label}</span>
      </label>
    );
  }

  return (
    <label
      className={`inline-flex items-start gap-3 cursor-pointer ${
        disabled ? "cursor-not-allowed opacity-60" : ""
      } ${className ?? ""}`}
    >
      <span className="mt-0.5">{toggle}</span>
      <span className="flex flex-col">
        <span className="text-[13px] text-foreground font-medium leading-tight">{label}</span>
        <span className="text-[11px] text-muted-foreground leading-tight mt-0.5">{description}</span>
      </span>
    </label>
  );
}
