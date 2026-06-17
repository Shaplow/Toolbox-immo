"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * Badge / tag — étiquette sémantique discrète flat shadcn.
 *
 * Variants :
 * - `default` : muted (zinc-100 + foreground)
 * - `success` / `danger` / `info` : semantic (50 background + 700 text)
 *
 * Les anciens variants pastels (peach/sage/sky/rose) du v2 et la prop `glass`
 * sont mappés vers `default` pour cohérence DA v3.
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
type ResolvedVariant = "default" | "success" | "danger" | "info";
type Size = "sm" | "md";

interface BadgeProps {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  /** Pastille colorée leading (pour statuts compacts). */
  dot?: boolean;
  /** Capitalize la première lettre (default true). */
  capitalize?: boolean;
  /** Legacy v2 — ignoré en DA v3. */
  glass?: boolean;
  className?: string;
  children: ReactNode;
}

function resolveVariant(v: Variant): ResolvedVariant {
  if (v === "success" || v === "danger" || v === "info") return v;
  return "default";
}

const VARIANT_CLS: Record<ResolvedVariant, string> = {
  default: "bg-muted text-foreground",
  success: "bg-success-50 text-success-700",
  danger:  "bg-danger-50 text-danger-700",
  info:    "bg-info-50 text-info-700",
};

const DOT_CLS: Record<ResolvedVariant, string> = {
  default: "bg-muted-foreground",
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
  glass: _glass,
  className,
  children,
}: BadgeProps) {
  void _glass;
  const resolved = resolveVariant(variant);
  const base = "inline-flex items-center gap-1 rounded-md font-medium leading-none";
  const sizeCls = size === "sm" ? "h-5 px-1.5 text-[11px]" : "h-6 px-2 text-[12px]";
  const iconSize = size === "sm" ? 10 : 12;
  const variantCls = VARIANT_CLS[resolved];

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
          className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${DOT_CLS[resolved]}`}
          aria-hidden
        />
      )}
      {Icon && <Icon size={iconSize} className="shrink-0" />}
      {children}
    </span>
  );
}
