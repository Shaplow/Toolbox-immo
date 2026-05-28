"use client";

import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Loader2 } from "lucide-react";

/**
 * Bouton primaire du design system.
 *
 * Variants :
 * - `primary`   — action principale standard, **mono dark** (gray-950). C'est le
 *                  CTA par défaut dans l'app. Sobre, Apple-like.
 * - `brand`     — CTA signature (orange brand) réservé aux moments forts
 *                  (S'inscrire, Mark publié, Démarrer un onboarding). Glow au
 *                  hover pour le "peps". À utiliser parcimonieusement.
 * - `secondary` — action secondaire, border gray-300, fond blanc.
 * - `ghost`     — action discrète, transparent hover gray-100.
 * - `danger`    — action destructive irréversible (suppression).
 *
 * Sizes : `sm` (compact toolbars) | `md` (default) | `lg` (hero CTA).
 *
 * États gérés : loading (spinner + cursor-wait), disabled (opacity-50),
 * focus-visible (anneau brand). Tous alignés sur la doctrine `États UI`.
 */

type Variant = "primary" | "brand" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "size"> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: LucideIcon;
  children: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    disabled,
    icon: Icon,
    children,
    className,
    ...rest
  },
  ref,
) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-all focus-ring disabled:opacity-50 disabled:cursor-not-allowed";

  const sizeClasses =
    size === "sm"
      ? "px-3 py-1.5 text-xs"
      : size === "lg"
        ? "px-5 py-2.5 text-sm"
        : "px-4 py-2 text-sm";

  const variantClasses = {
    primary:
      "bg-gray-950 text-white hover:bg-gray-800",
    brand:
      "bg-brand-600 text-white shadow-[var(--shadow-glow-brand)] hover:bg-brand-700 hover:shadow-[var(--shadow-glow-brand-strong)] hover:-translate-y-0.5",
    secondary:
      "bg-white text-gray-800 border border-gray-300 hover:bg-gray-50 hover:border-gray-400",
    ghost:
      "bg-transparent text-gray-700 hover:bg-gray-100 hover:text-gray-950",
    danger:
      "bg-danger-600 text-white hover:bg-danger-700",
  }[variant];

  const iconSize = size === "sm" ? 12 : size === "lg" ? 16 : 14;

  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={[base, sizeClasses, variantClasses, className ?? ""].filter(Boolean).join(" ")}
      {...rest}
    >
      {loading ? (
        <Loader2 size={iconSize} className="animate-spin" />
      ) : Icon ? (
        <Icon size={iconSize} />
      ) : null}
      {children}
    </button>
  );
});
