"use client";

import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Loader2 } from "lucide-react";

/**
 * Button — flat shadcn-style (v3 big bang DA 2026-06-15).
 *
 * Variants vivants :
 * - `default` (recommandé)  — primary indigo. CTA principal.
 * - `secondary`             — zinc-100 background. Action secondaire.
 * - `outline`               — border zinc-200 + transparent. Action tertiaire.
 * - `ghost`                 — transparent, hover muted. Discret.
 * - `destructive`           — danger red. Action destructive.
 * - `link`                  — texte underline only.
 *
 * Backward compat : les anciens variants `primary`/`softPrimary` → `default`,
 * `glass` → `secondary`, `danger` → `destructive`. Aucun call site externe à
 * mettre à jour en urgence ; le sweep Phase D nettoiera.
 *
 * Sizes : `sm` (h-7) | `md` (default, h-8) | `lg` (h-9). Densité serrée.
 *
 * Convention icon : toute action significative DEVRAIT porter une `icon`.
 * Voir `ButtonIcon` pour l'icon-only carré.
 */

type Variant =
  | "default"
  | "secondary"
  | "outline"
  | "ghost"
  | "destructive"
  | "link"
  // Legacy aliases — mappés en interne, conservés pour compat call sites V1/V2.
  | "primary"
  | "softPrimary"
  | "glass"
  | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "size"> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: LucideIcon;
  /** Place l'icône à droite (par défaut à gauche). Pour les liens "Voir →". */
  iconRight?: boolean;
  children: ReactNode;
}

type ResolvedVariant = "default" | "secondary" | "outline" | "ghost" | "destructive" | "link";

function resolveVariant(v: Variant): ResolvedVariant {
  switch (v) {
    case "primary":
    case "softPrimary":
      return "default";
    case "glass":
      return "secondary";
    case "danger":
      return "destructive";
    default:
      return v;
  }
}

const VARIANT_CLS: Record<ResolvedVariant, string> = {
  default:
    "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 focus-ring",
  secondary:
    "bg-secondary text-secondary-foreground border border-border hover:bg-muted focus-ring",
  outline:
    "bg-transparent text-foreground border border-border hover:bg-muted focus-ring",
  ghost:
    "bg-transparent text-foreground hover:bg-muted focus-ring",
  destructive:
    "bg-danger-600 text-white shadow-sm hover:bg-danger-700 focus-ring-danger",
  link:
    "bg-transparent text-primary underline-offset-4 hover:underline px-0 h-auto focus-ring",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "default",
    size = "md",
    loading = false,
    disabled,
    icon: Icon,
    iconRight = false,
    children,
    className,
    ...rest
  },
  ref,
) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

  const sizeClasses =
    size === "sm"
      ? "h-7 px-2.5 text-[12px]"
      : size === "lg"
        ? "h-9 px-4 text-sm"
        : "h-8 px-3 text-[13px]";

  const v = resolveVariant(variant);
  const variantClasses = VARIANT_CLS[v];

  const iconSize = size === "sm" ? 12 : size === "lg" ? 15 : 14;

  const iconNode = loading ? (
    <Loader2 size={iconSize} className="animate-spin" />
  ) : Icon ? (
    <Icon size={iconSize} />
  ) : null;

  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={[base, sizeClasses, variantClasses, className ?? ""].filter(Boolean).join(" ")}
      {...rest}
    >
      {!iconRight && iconNode}
      {children}
      {iconRight && iconNode}
    </button>
  );
});
