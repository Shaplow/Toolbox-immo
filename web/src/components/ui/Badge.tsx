"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * Badge / pill — étiquette sémantique pour statuts, comptes, tags.
 *
 * Variants : default (gray neutre) + 3 accents sémantiques. Soft = fond
 * teinté + texte foncé (cas standard). Aucun variant brand — la brand
 * orange est réservée au logo et au dot nav, jamais aux badges.
 *
 * Sizes : sm (h-5, default) | md (h-6).
 *
 * `icon?: LucideIcon` ou `dot?: boolean` pour préfixer.
 */

type Variant = "default" | "success" | "danger" | "info";
type Size = "sm" | "md";

interface BadgeProps {
  variant?: Variant;
  size?: Size;
  /** Icône Lucide leading (15% des cas). */
  icon?: LucideIcon;
  /** Pastille colorée leading (pour statuts compacts). */
  dot?: boolean;
  className?: string;
  children: ReactNode;
}

const VARIANT_CLS = {
  default: "bg-gray-100 text-gray-700 border-gray-200",
  success: "bg-success-50 text-success-700 border-success-100",
  danger:  "bg-danger-50 text-danger-700 border-danger-100",
  info:    "bg-info-50 text-info-700 border-info-100",
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
  className,
  children,
}: BadgeProps) {
  const base =
    "inline-flex items-center gap-1 rounded-full border font-medium leading-none";
  const sizeCls = size === "sm" ? "h-5 px-2 text-[11px]" : "h-6 px-2.5 text-[12px]";
  const iconSize = size === "sm" ? 10 : 12;

  return (
    <span
      className={[base, sizeCls, VARIANT_CLS[variant], className ?? ""].filter(Boolean).join(" ")}
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
