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
 * - Densité serrée par défaut (h-8). Borderless / borderé selon contexte.
 */

import type { ReactNode } from "react";

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  icon?: LucideIcon;
  trailing?: ReactNode;
}

export function Input({
  value,
  onChange,
  error,
  icon: Icon,
  trailing,
  className,
  disabled,
  ...rest
}: InputProps) {
  const wrapperBase =
    "group/input flex items-center gap-2 w-full h-8 rounded-md border bg-white transition-colors";
  const wrapperState = error
    ? "border-danger-600 focus-within:shadow-[var(--shadow-focus-ring-danger)]"
    : "border-gray-300 hover:border-gray-400 focus-within:border-gray-400 focus-within:shadow-[var(--shadow-focus-ring)]";
  const wrapperDisabled = disabled ? "bg-gray-50 opacity-60 cursor-not-allowed" : "";

  return (
    <div className={[wrapperBase, wrapperState, wrapperDisabled, className ?? ""].filter(Boolean).join(" ")}>
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
