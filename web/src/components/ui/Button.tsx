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
    // Primary "liquid graphite" — gradient gray-700 → gray-900 + ring inset
    // top blanc 0.18 visible (highlight signature), edge subtle, ombre
    // intérieure bottom + ombre proche + halo extérieur diffus. Le primary
    // gagne lui aussi la signature liquide sans renier la doctrine mono dark.
    primary:
      "bg-gradient-to-b from-gray-700 to-gray-900 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),inset_0_0_0_1px_rgba(255,255,255,0.04),inset_0_-1px_0_rgba(0,0,0,0.18),0_1px_2px_rgba(15,23,42,0.12),0_4px_12px_-4px_rgba(15,23,42,0.22)] hover:from-gray-600 hover:to-gray-800 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.24),inset_0_0_0_1px_rgba(255,255,255,0.06),inset_0_-1px_0_rgba(0,0,0,0.2),0_2px_4px_rgba(15,23,42,0.16),0_8px_20px_-4px_rgba(15,23,42,0.28)] focus-ring",
    secondary:
      "bg-white text-gray-800 border border-gray-300 hover:bg-gray-50 hover:border-gray-400 focus-ring",
    ghost:
      "bg-transparent text-gray-700 hover:bg-gray-100 hover:text-gray-950 focus-ring",
    danger:
      "bg-danger-600 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] hover:bg-danger-700 focus-ring-danger",
    // Liquid Glass v2 — vrai verre macOS Tahoe / iOS 18 :
    // ring intérieur top blanc prononcé (highlight spéculaire) + ring edge
    // subtle + halo extérieur diffus. Background gradient frosted blanc
    // top → translucide bottom donne l'impression d'épaisseur réelle.
    glass:
      "bg-gradient-to-b from-white/70 to-white/40 text-gray-900 backdrop-blur-[18px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(255,255,255,0.35),inset_0_-1px_0_rgba(15,23,42,0.06),0_1px_2px_rgba(15,23,42,0.05),0_8px_24px_-8px_rgba(15,23,42,0.18)] hover:from-white/85 hover:to-white/55 hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.5),inset_0_-1px_0_rgba(15,23,42,0.08),0_2px_4px_rgba(15,23,42,0.06),0_12px_32px_-8px_rgba(15,23,42,0.22)] focus-ring",
    // Liquid Glass v2 — graphite tinted warm peach (signature "chaleur").
    // Highlight intérieur teinté + halo extérieur peach diffus au hover.
    softPrimary:
      "bg-gradient-to-b from-gray-700 to-gray-900 text-white shadow-[inset_0_1px_0_rgba(255,200,170,0.28),inset_0_0_0_1px_rgba(255,200,170,0.08),0_1px_2px_rgba(15,23,42,0.12),0_6px_20px_-8px_rgba(245,158,107,0.45)] hover:from-gray-600 hover:to-gray-800 hover:shadow-[inset_0_1px_0_rgba(255,200,170,0.42),inset_0_0_0_1px_rgba(255,200,170,0.12),0_2px_4px_rgba(15,23,42,0.16),0_10px_28px_-8px_rgba(245,158,107,0.6)] focus-ring",
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
