"use client";

import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Loader2 } from "lucide-react";

/**
 * Bouton primaire — doctrine SaaS d'équipe : Vercel · Linear · Apple.
 *
 * Variants :
 * - `primary`     — `bg-gray-800` graphite poli. Le CTA principal de chaque
 *                    page. Sobre, lisible, intemporel.
 * - `secondary`   — border gray-300. Action secondaire.
 * - `ghost`       — transparent hover gray-100. Action discrète.
 * - `danger`      — danger-600. Action destructive.
 * - `glass`       — Liquid Glass v2. Transparent + backdrop-blur + ring
 *                    intérieur. Pour actions secondaires sur surfaces glass.
 *                    Jamais en CTA primary.
 * - `softPrimary` — Liquid Glass v2. Graphite tinted warm (peach mix subtile).
 *                    Variante chaleureuse du primary, utile sur surfaces
 *                    pastel.
 *
 * Sizes : `sm` (toolbars compactes, h-7) | `md` (default, h-8) |
 * `lg` (CTA standout, h-9). Densité serrée Linear-style.
 *
 * Convention icon : toute action significative DEVRAIT porter une
 * `icon`. C'est ce qui distingue l'app dense d'une app à label.
 * Voir `ButtonIcon` pour l'icon-only carré.
 */

type Variant = "primary" | "secondary" | "ghost" | "danger" | "glass" | "softPrimary";
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

  const sizeClasses =
    size === "sm"
      ? "h-7 px-2.5 text-[12px]"
      : size === "lg"
        ? "h-9 px-4 text-sm"
        : "h-8 px-3 text-[13px]";

  const variantClasses = {
    // Primary "graphite chaud" — gray-800 au lieu de noir mort. Ombre
    // intérieure blanche subtle pour caractère, hover plus clair +
    // ombre extérieure douce. Donne le "métal poli" sans tomber dans
    // le shadcn brut.
    primary:
      "bg-gray-800 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] hover:bg-gray-700 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_4px_12px_rgba(0,0,0,0.1)] focus-ring",
    secondary:
      "bg-white text-gray-800 border border-gray-300 hover:bg-gray-50 hover:border-gray-400 focus-ring",
    ghost:
      "bg-transparent text-gray-700 hover:bg-gray-100 hover:text-gray-950 focus-ring",
    danger:
      "bg-danger-600 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] hover:bg-danger-700 focus-ring-danger",
    // Liquid Glass v2 — verre transparent + ring intérieur signature.
    glass:
      "bg-[var(--surface-glass-medium)] text-gray-800 backdrop-blur-[12px] backdrop-saturate-150 shadow-[var(--ring-glass-edge)] hover:bg-[var(--surface-glass-strong)] hover:shadow-[var(--ring-glass-inset),var(--shadow-glass-sm)] focus-ring",
    // Liquid Glass v2 — graphite tinted warm peach (signature "chaleur").
    softPrimary:
      "bg-gray-800 text-white shadow-[inset_0_1px_0_rgba(255,200,170,0.18)] hover:bg-gray-700 hover:shadow-[inset_0_1px_0_rgba(255,200,170,0.24),0_4px_16px_rgba(245,158,107,0.18)] focus-ring",
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
