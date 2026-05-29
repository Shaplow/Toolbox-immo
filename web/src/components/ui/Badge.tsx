"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * Badge / tag — étiquette sémantique discrète, style Linear / Vercel.
 *
 * Forme rounded-md (au lieu de rounded-full pill) pour un look "tag de
 * statut" plus qu'un "pill marketing". Density élevée (h-5 par défaut).
 *
 * Variants :
 * - `default` / `success` / `danger` / `info` — sémantiques (statuts).
 * - `peach` / `sage` / `sky` / `rose` — Liquid Glass v2 / Coastal Studio.
 *    Accents pastels pour catégories, tags, signature soft.
 *
 * Option `glass` (Liquid Glass v2) : background transparent + backdrop-blur,
 * ring intérieur signature. Pour badges flottants sur surface tinted.
 *
 * Capitalize : la prop `capitalize` (default true) met la première
 * lettre en majuscule via CSS, pour éviter les "publié" inconvenants.
 *
 * Pas de variant brand — la brand orange est réservée au logo et au
 * dot nav, jamais aux badges.
 */

type Variant =
  | "default"
  | "success"
  | "danger"
  | "info"
  | "peach"
  | "sage"
  | "sky"
  | "rose";
type Size = "sm" | "md";

interface BadgeProps {
  variant?: Variant;
  size?: Size;
  /** Icône Lucide leading. */
  icon?: LucideIcon;
  /** Pastille colorée leading (pour statuts compacts). */
  dot?: boolean;
  /** Capitalize la première lettre (default true). */
  capitalize?: boolean;
  /** Liquid Glass v2 — transparent + backdrop-blur + ring intérieur. */
  glass?: boolean;
  className?: string;
  children: ReactNode;
}

const VARIANT_CLS: Record<Variant, string> = {
  default: "bg-gray-100 text-gray-700",
  success: "bg-success-50 text-success-700",
  danger:  "bg-danger-50 text-danger-700",
  info:    "bg-info-50 text-info-700",
  peach:   "bg-peach-50 text-peach-700",
  sage:    "bg-sage-50 text-sage-700",
  sky:     "bg-sky-50 text-sky-700",
  rose:    "bg-rose-50 text-rose-700",
};

// Variant tinted en mode glass : background transparent légèrement teinté +
// blur + ring intérieur signature. Garde la text color du variant.
const GLASS_VARIANT_CLS: Record<Variant, string> = {
  default: "bg-white/50 text-gray-700 backdrop-blur-[8px] shadow-[var(--ring-glass-edge)]",
  success: "bg-success-50/50 text-success-700 backdrop-blur-[8px] shadow-[var(--ring-glass-edge)]",
  danger:  "bg-danger-50/50 text-danger-700 backdrop-blur-[8px] shadow-[var(--ring-glass-edge)]",
  info:    "bg-info-50/50 text-info-700 backdrop-blur-[8px] shadow-[var(--ring-glass-edge)]",
  peach:   "bg-peach-50/50 text-peach-700 backdrop-blur-[8px] shadow-[var(--ring-glass-edge)]",
  sage:    "bg-sage-50/50 text-sage-700 backdrop-blur-[8px] shadow-[var(--ring-glass-edge)]",
  sky:     "bg-sky-50/50 text-sky-700 backdrop-blur-[8px] shadow-[var(--ring-glass-edge)]",
  rose:    "bg-rose-50/50 text-rose-700 backdrop-blur-[8px] shadow-[var(--ring-glass-edge)]",
};

const DOT_CLS: Record<Variant, string> = {
  default: "bg-gray-400",
  success: "bg-success-600",
  danger:  "bg-danger-600",
  info:    "bg-info-600",
  peach:   "bg-peach-500",
  sage:    "bg-sage-500",
  sky:     "bg-sky-500",
  rose:    "bg-rose-500",
};

export function Badge({
  variant = "default",
  size = "sm",
  icon: Icon,
  dot = false,
  capitalize = true,
  glass = false,
  className,
  children,
}: BadgeProps) {
  const base =
    "inline-flex items-center gap-1 rounded-md font-medium leading-none";
  const sizeCls = size === "sm" ? "h-5 px-1.5 text-[11px]" : "h-6 px-2 text-[12px]";
  const iconSize = size === "sm" ? 10 : 12;
  const variantCls = glass ? GLASS_VARIANT_CLS[variant] : VARIANT_CLS[variant];

  return (
    <span
      className={[
        base,
        sizeCls,
        variantCls,
        capitalize ? "first-letter:uppercase" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {dot && (
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${DOT_CLS[variant]}`}
          aria-hidden
        />
      )}
      {Icon && <Icon size={iconSize} className="shrink-0" />}
      {children}
    </span>
  );
}
