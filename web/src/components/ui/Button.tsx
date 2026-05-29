"use client";

import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Loader2 } from "lucide-react";

/**
 * Bouton primaire — direction Linear · Vercel · Raycast.
 *
 * Variants :
 * - `primary`   — gray-950 mono. CTA standard. Focus ring mono.
 * - `brand`     — orange + glow. Réservé aux 2-3 spots signature de
 *                  toute l'app (S'inscrire, Démarrer onboarding,
 *                  Mark publié peut-être). Focus ring brand.
 * - `secondary` — border gray-300. Action secondaire.
 * - `ghost`     — transparent hover gray-100. Action discrète.
 * - `danger`    — danger-600. Action destructive.
 *
 * Sizes : `sm` (toolbars compactes) | `md` (default UI) | `lg` (hero CTA).
 * Densité serrée par défaut — alignée Linear/Vercel.
 *
 * Convention icon : tout button avec une action significative devrait
 * porter une `icon`. C'est ce qui distingue l'app dense d'une app à
 * label. Voir `ButtonIcon` pour l'icon-only carré.
 */

type Variant = "primary" | "brand" | "secondary" | "ghost" | "danger";
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

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
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
    "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed";

  // Density serrée à la Linear : h-7 / h-8 / h-9.
  const sizeClasses =
    size === "sm"
      ? "h-7 px-2.5 text-[12px]"
      : size === "lg"
        ? "h-9 px-4 text-sm"
        : "h-8 px-3 text-[13px]";

  const variantClasses = {
    primary:
      "bg-gray-950 text-white hover:bg-gray-800 focus-ring",
    brand:
      "bg-brand-600 text-white shadow-[var(--shadow-glow-brand)] hover:bg-brand-700 hover:shadow-[var(--shadow-glow-brand-strong)] hover:-translate-y-[1px] focus-ring-brand",
    secondary:
      "bg-white text-gray-800 border border-gray-300 hover:bg-gray-50 hover:border-gray-400 focus-ring",
    ghost:
      "bg-transparent text-gray-700 hover:bg-gray-100 hover:text-gray-950 focus-ring",
    danger:
      "bg-danger-600 text-white hover:bg-danger-700 focus-ring-danger",
  }[variant];

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
