"use client";

import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import { Loader2 } from "lucide-react";

/**
 * Bouton icon-only carré — pattern Linear · Raycast · Vercel.
 *
 * Pour toolbars denses (close, more, copy, refresh) et icon actions
 * dans les rows hover. Le `label` est obligatoire (sr-only + title)
 * pour l'a11y.
 *
 * Variants : reprennent ceux de <Button>. Forme strictement carrée.
 *
 * Option `floating` : Liquid Glass v2. FAB style avec backdrop-blur +
 * shadow-glass-md. Pour les actions flottantes au-dessus d'une zone
 * de contenu (overlay player, surface glass).
 */

type Variant = "primary" | "secondary" | "ghost" | "danger" | "glass";
type Size = "sm" | "md";

interface ButtonIconProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "size" | "aria-label"> {
  icon: LucideIcon;
  /** Label accessible (sr-only + title). Obligatoire. */
  label: string;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /** FAB style flottant (Liquid Glass v2) — shadow-glass-md + backdrop-blur. */
  floating?: boolean;
}

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
  const base =
    "inline-flex items-center justify-center rounded-md transition-all disabled:opacity-50 disabled:cursor-not-allowed";
  const sizeClasses = size === "sm" ? "h-7 w-7" : "h-8 w-8";

  const variantClasses = {
    // Primary "liquid graphite" — aligné avec Button primary.
    primary:
      "bg-gradient-to-b from-gray-700 to-gray-900 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),inset_0_0_0_1px_rgba(255,255,255,0.04),inset_0_-1px_0_rgba(0,0,0,0.18),0_1px_2px_rgba(15,23,42,0.12),0_4px_12px_-4px_rgba(15,23,42,0.22)] hover:from-gray-600 hover:to-gray-800 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.24),inset_0_0_0_1px_rgba(255,255,255,0.06),inset_0_-1px_0_rgba(0,0,0,0.2),0_2px_4px_rgba(15,23,42,0.16),0_8px_20px_-4px_rgba(15,23,42,0.28)] focus-ring",
    secondary:
      "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 hover:text-gray-950 hover:border-gray-400 focus-ring",
    ghost:
      "bg-transparent text-gray-500 hover:bg-gray-100 hover:text-gray-950 focus-ring",
    danger:
      "bg-transparent text-gray-500 hover:bg-danger-50 hover:text-danger-600 focus-ring-danger",
    // Liquid Glass v2 — même signature liquide que Button glass : gradient
    // frosted + ring inset top blanc prononcé + halo extérieur diffus.
    glass:
      "bg-gradient-to-b from-white/70 to-white/40 text-gray-800 backdrop-blur-[18px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(255,255,255,0.35),inset_0_-1px_0_rgba(15,23,42,0.06),0_1px_2px_rgba(15,23,42,0.05),0_8px_24px_-8px_rgba(15,23,42,0.18)] hover:from-white/85 hover:to-white/55 hover:text-gray-950 hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.5),inset_0_-1px_0_rgba(15,23,42,0.08),0_2px_4px_rgba(15,23,42,0.06),0_12px_32px_-8px_rgba(15,23,42,0.22)] focus-ring",
  }[variant];

  // FAB style — élévation forte + gradient frosted + halo diffus rond pour
  // signature flottante macOS Sequoia. Rond pour distinguer du carré.
  const floatingCls = floating
    ? "rounded-full bg-gradient-to-b from-white/80 to-white/50 text-gray-800 backdrop-blur-[24px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.45),inset_0_-2px_0_rgba(15,23,42,0.08),0_2px_4px_rgba(15,23,42,0.08),0_16px_40px_-12px_rgba(15,23,42,0.28)] hover:text-gray-950 hover:from-white/95 hover:to-white/65 hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.55),inset_0_-2px_0_rgba(15,23,42,0.1),0_4px_8px_rgba(15,23,42,0.1),0_24px_56px_-12px_rgba(15,23,42,0.36)]"
    : "";

  const iconSize = size === "sm" ? 13 : 15;

  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      title={label}
      aria-label={label}
      aria-busy={loading || undefined}
      className={[base, sizeClasses, floating ? floatingCls : variantClasses, className ?? ""].filter(Boolean).join(" ")}
      {...rest}
    >
      {loading ? <Loader2 size={iconSize} className="animate-spin" /> : <Icon size={iconSize} />}
    </button>
  );
});
