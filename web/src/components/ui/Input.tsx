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
  // v3 big bang DA — flat shadcn : input white avec border zinc-200, focus
  // ring primary, error border red. La prop `variant` (default/glass) reste
  // typée pour compat mais les 2 produisent maintenant le même rendu flat.
  void variant;

  const wrapperBase =
    "group/input flex items-center gap-2 w-full h-8 rounded-md transition-colors bg-card border";

  const wrapperState = error
    ? "border-danger-600 focus-within:ring-2 focus-within:ring-danger-600/30"
    : "border-input hover:border-zinc-300 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30";

  const wrapperDisabled = disabled ? "opacity-60 cursor-not-allowed" : "";

  return (
    <div className={[wrapperBase, wrapperState, wrapperDisabled, className ?? ""].filter(Boolean).join(" ")}>
      {Icon && (
        <Icon
          size={14}
          className="shrink-0 ml-2.5 text-muted-foreground group-focus-within/input:text-foreground transition-colors"
        />
      )}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        className={`flex-1 min-w-0 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground outline-none ${
          Icon ? "pl-0" : "pl-2.5"
        } ${trailing ? "pr-0" : "pr-2.5"}`}
        {...rest}
      />
      {trailing && <span className="shrink-0 pr-2 text-[11px] text-muted-foreground">{trailing}</span>}
    </div>
  );
}
