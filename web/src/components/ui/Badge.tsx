"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * Badge / tag — étiquette sémantique discrète, style Linear / Vercel.
 *
 * Forme rounded-md (au lieu de rounded-full pill) pour un look "tag de
 * statut" plus qu'un "pill marketing". Density élevée (h-5 par défaut).
 *
 * Variants : default (gray neutre) + 3 accents sémantiques.
 * Capitalize : la prop `capitalize` (default true) met la première
 * lettre en majuscule via CSS, pour éviter les "publié" inconvenants.
 *
 * Pas de variant brand — la brand orange est réservée au logo et au
 * dot nav, jamais aux badges.
 */

type Variant = "default" | "success" | "danger" | "info";
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
  className?: string;
  children: ReactNode;
}

const VARIANT_CLS = {
  default: "bg-gray-100 text-gray-700",
  success: "bg-success-50 text-success-700",
  danger:  "bg-danger-50 text-danger-700",
  info:    "bg-info-50 text-info-700",
};

const DOT_CLS = {
  default: "bg-gray-400",
  success: "bg-success-600",
  danger:  "bg-danger-600",
  info:    "bg-info-600",
};

export function Badge({
  variant = "default",
  size = "sm",
  icon: Icon,
  dot = false,
  capitalize = true,
  className,
  children,
}: BadgeProps) {
  const base =
    "inline-flex items-center gap-1 rounded-md font-medium leading-none";
  const sizeCls = size === "sm" ? "h-5 px-1.5 text-[11px]" : "h-6 px-2 text-[12px]";
  const iconSize = size === "sm" ? 10 : 12;

  return (
    <span
      className={[
        base,
        sizeCls,
        VARIANT_CLS[variant],
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
