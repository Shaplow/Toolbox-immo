"use client";

import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import { Loader2 } from "lucide-react";

/**
 * Bouton icon-only carré flat shadcn.
 *
 * Pour toolbars denses (close, more, copy, refresh) et icon actions dans rows hover.
 * Le `label` est obligatoire (sr-only + title) pour l'a11y.
 *
 * Variants alignés avec Button. Variant `glass` legacy mappé vers `secondary`.
 */

type Variant = "primary" | "secondary" | "ghost" | "danger" | "glass";
type ResolvedVariant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

interface ButtonIconProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "size" | "aria-label"> {
  icon: LucideIcon;
  label: string;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /** FAB style flottant — pill rond avec ombre forte. */
  floating?: boolean;
}

function resolveVariant(v: Variant): ResolvedVariant {
  if (v === "glass") return "secondary";
  return v;
}

const VARIANT_CLS: Record<ResolvedVariant, string> = {
  primary:   "bg-primary text-primary-foreground hover:bg-primary/90 focus-ring",
  secondary: "bg-secondary text-secondary-foreground border border-border hover:bg-muted focus-ring",
  ghost:     "bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground focus-ring",
  danger:    "bg-transparent text-muted-foreground hover:bg-danger-50 hover:text-danger-600 focus-ring-danger",
};

export const ButtonIcon = forwardRef<HTMLButtonElement, ButtonIconProps>(function ButtonIcon(
  {
    icon: Icon,
    label,
    variant = "ghost",
    size = "md",
    loading = false,
    floating = false,
    disabled,
    className,
    ...rest
  },
  ref,
) {
  const resolved = resolveVariant(variant);
  const base =
    "inline-flex items-center justify-center rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const sizeClasses = size === "sm" ? "h-7 w-7" : "h-8 w-8";

  const floatingCls = floating
    ? "rounded-full bg-card text-foreground border border-border shadow-lg hover:bg-muted"
    : VARIANT_CLS[resolved];

  const iconSize = size === "sm" ? 13 : 15;

  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      title={label}
      aria-label={label}
      aria-busy={loading || undefined}
      className={[base, sizeClasses, floatingCls, className ?? ""].filter(Boolean).join(" ")}
      {...rest}
    >
      {loading ? <Loader2 size={iconSize} className="animate-spin" /> : <Icon size={iconSize} />}
    </button>
  );
});
