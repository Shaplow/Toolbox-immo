"use client";

import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import { Loader2 } from "lucide-react";

/**
 * Bouton icon-only carré (pattern Linear · Raycast · Vercel).
 *
 * Pour les toolbars denses et actions secondaires (close, more, copy,
 * refresh, etc.). Le `label` est obligatoire mais visuellement masqué
 * (sr-only + title) pour l'accessibilité.
 *
 * Variants : reprennent ceux de <Button>. Sizes : sm | md (md = défaut).
 * Forme strictement carrée pour rester dense.
 */

type Variant = "primary" | "brand" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

interface ButtonIconProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "size" | "aria-label"> {
  icon: LucideIcon;
  /** Label accessible (sr-only + title). Obligatoire. */
  label: string;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const ButtonIcon = forwardRef<HTMLButtonElement, ButtonIconProps>(function ButtonIcon(
  {
    icon: Icon,
    label,
    variant = "ghost",
    size = "md",
    loading = false,
    disabled,
    className,
    ...rest
  },
  ref,
) {
  const base =
    "inline-flex items-center justify-center rounded-md transition-all disabled:opacity-50 disabled:cursor-not-allowed";
  const sizeClasses = size === "sm" ? "h-7 w-7" : "h-8 w-8";

  const variantClasses = {
    primary:
      "bg-gray-950 text-white hover:bg-gray-800 focus-ring",
    brand:
      "bg-brand-600 text-white shadow-[var(--shadow-glow-brand)] hover:bg-brand-700 hover:shadow-[var(--shadow-glow-brand-strong)] focus-ring-brand",
    secondary:
      "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 hover:text-gray-950 hover:border-gray-400 focus-ring",
    ghost:
      "bg-transparent text-gray-500 hover:bg-gray-100 hover:text-gray-950 focus-ring",
    danger:
      "bg-transparent text-gray-500 hover:bg-danger-50 hover:text-danger-600 focus-ring-danger",
  }[variant];

  const iconSize = size === "sm" ? 13 : 15;

  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      title={label}
      aria-label={label}
      aria-busy={loading || undefined}
      className={[base, sizeClasses, variantClasses, className ?? ""].filter(Boolean).join(" ")}
      {...rest}
    >
      {loading ? <Loader2 size={iconSize} className="animate-spin" /> : <Icon size={iconSize} />}
    </button>
  );
});
