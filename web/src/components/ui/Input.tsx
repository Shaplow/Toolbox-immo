"use client";

import type { InputHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * Input texte — direction Linear · Vercel.
 *
 * - API contrôlée : `value` (string) + `onChange(value: string)`.
 * - `error?: string` → border + focus-ring danger + aria-invalid.
 * - `icon?: LucideIcon` → icône leading dans le champ (clarté
 *   instantanée, pattern Linear). Optionnel mais fortement
 *   recommandé pour les inputs typés (email, search, url, etc.).
 * - `trailing?: ReactNode` → contenu à droite (raccourci, badge, etc.).
 * - `variant?: "default" | "glass"` (Liquid Glass v2) — `glass` rend
 *   l'input transparent + halo pastel sky au focus. Pour formulaires
 *   posés sur surface glass/tinted. Défaut "default" inchangé.
 * - Densité serrée par défaut (h-8). Borderless / borderé selon contexte.
 */

import type { ReactNode } from "react";

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  icon?: LucideIcon;
  trailing?: ReactNode;
  variant?: "default" | "glass";
}

export function Input({
  value,
  onChange,
  error,
  icon: Icon,
  trailing,
  variant = "default",
  className,
  disabled,
  ...rest
}: InputProps) {
  const wrapperBase =
    "group/input flex items-center gap-2 w-full h-8 rounded-md transition-colors";

  // Background + état focus selon variant.
  // Default = semi-verre : gradient blanc + backdrop-blur léger + ring inset
  // signature. Glass = transparent + halo pastel sky au focus.
  const wrapperVariantBase =
    variant === "glass"
      ? "bg-[var(--surface-glass-medium)] backdrop-blur-[8px] backdrop-saturate-150 border border-white/40"
      : "bg-gradient-to-b from-white to-white/85 backdrop-blur-[8px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),0_1px_2px_rgba(15,23,42,0.04)]";

  const wrapperState = error
    ? variant === "glass"
      ? "border-danger-600 focus-within:shadow-[var(--shadow-focus-ring-danger)]"
      : "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(220,38,38,0.6),0_1px_2px_rgba(220,38,38,0.12)] focus-within:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(220,38,38,0.8),0_0_0_3px_rgba(220,38,38,0.22)]"
    : variant === "glass"
      ? "hover:border-sky-200 focus-within:border-sky-300 focus-within:shadow-[0_0_0_3px_rgba(169,209,230,0.32)]"
      : "hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.14),0_1px_2px_rgba(15,23,42,0.05)] focus-within:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.2),0_0_0_3px_rgba(10,10,10,0.12)]";

  const wrapperDisabled = disabled ? "opacity-60 cursor-not-allowed" : "";

  return (
    <div className={[wrapperBase, wrapperVariantBase, wrapperState, wrapperDisabled, className ?? ""].filter(Boolean).join(" ")}>
      {Icon && (
        <Icon
          size={14}
          className="shrink-0 ml-2.5 text-gray-400 group-focus-within/input:text-gray-700 transition-colors"
        />
      )}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        className={`flex-1 min-w-0 bg-transparent text-[13px] text-gray-950 placeholder:text-gray-400 outline-none ${
          Icon ? "pl-0" : "pl-2.5"
        } ${trailing ? "pr-0" : "pr-2.5"}`}
        {...rest}
      />
      {trailing && <span className="shrink-0 pr-2 text-[11px] text-gray-400">{trailing}</span>}
    </div>
  );
}
