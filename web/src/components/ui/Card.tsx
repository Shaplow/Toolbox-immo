"use client";

import type { ReactNode } from "react";

/**
 * Conteneur Card — pattern Linear · Vercel.
 *
 * - `interactive` : ajoute hover lift + cursor-pointer (pour cards
 *                    cliquables). Pour les Links, préférer un wrapper
 *                    <Link><Card interactive>...</Card></Link>.
 * - `padded`    : applique p-5 (default true). Mettre false pour les
 *                  cards qui contiennent leurs propres sections
 *                  (Header / Body / Footer custom).
 * - `border`    : montre la border gray-200 (default true).
 * - `variant?`  : Liquid Glass v2. `solid` (default, white solide) |
 *                  `glass` (transparent + backdrop-blur + ring intérieur) |
 *                  `frosted` (gradient frosted blanc) | `tinted` (pastel
 *                  Coastal Studio léger). Défaut "solid" — aucun changement
 *                  visuel sur les cards existantes.
 * - `tint?`     : Liquid Glass v2. Quand `variant="tinted"` ou `"glass"`,
 *                  choisir la teinte pastel : `peach` (chaleur),
 *                  `sage` (calme), `sky` (info), `rose` (signature rare).
 */

type CardVariant = "solid" | "glass" | "frosted" | "tinted";
type CardTint = "peach" | "sage" | "sky" | "rose";

interface CardProps {
  children: ReactNode;
  interactive?: boolean;
  padded?: boolean;
  border?: boolean;
  variant?: CardVariant;
  tint?: CardTint;
  className?: string;
}

const TINT_BG: Record<CardTint, string> = {
  peach: "bg-peach-50",
  sage:  "bg-sage-50",
  sky:   "bg-sky-50",
  rose:  "bg-rose-50",
};

const TINT_BORDER: Record<CardTint, string> = {
  peach: "border-peach-100",
  sage:  "border-sage-100",
  sky:   "border-sky-100",
  rose:  "border-rose-100",
};

const GLASS_TINT_BG: Record<CardTint, string> = {
  peach: "bg-[linear-gradient(135deg,rgba(255,230,208,0.45),rgba(255,245,237,0.15))]",
  sage:  "bg-[linear-gradient(135deg,rgba(220,238,224,0.45),rgba(241,247,242,0.15))]",
  sky:   "bg-[linear-gradient(135deg,rgba(212,232,243,0.45),rgba(239,246,251,0.15))]",
  rose:  "bg-[linear-gradient(135deg,rgba(247,221,226,0.45),rgba(253,242,244,0.15))]",
};

export function Card({
  children,
  interactive = false,
  padded = true,
  border = true,
  variant = "solid",
  tint,
  className,
}: CardProps) {
  // Base par variant.
  // Solid = semi-verre subtil : gradient blanc + backdrop-blur léger + ring
  // inset signature. Garde le look "carte document" mais avec matière.
  const variantBase = {
    solid:   "bg-gradient-to-b from-white to-white/85 backdrop-blur-[10px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_-1px_0_rgba(15,23,42,0.04),0_1px_2px_rgba(15,23,42,0.04)]",
    glass:   "bg-[var(--surface-glass-strong)] backdrop-blur-[20px] backdrop-saturate-150 shadow-[var(--ring-glass-inset)]",
    frosted: "bg-[var(--gradient-frosted)] backdrop-blur-[12px] backdrop-saturate-150 shadow-[var(--ring-glass-edge)]",
    tinted:  tint ? TINT_BG[tint] : "bg-gray-50",
  }[variant];

  const base = `${variantBase} rounded-lg overflow-hidden`;

  // Border par variant : tinted utilise la teinte légère ; glass/frosted/solid
  // hide la border classique (le ring intérieur fait la séparation).
  const borderCls = !border
    ? ""
    : variant === "tinted" && tint
      ? `border ${TINT_BORDER[tint]}`
      : variant === "glass" || variant === "frosted" || variant === "solid"
        ? ""
        : "border border-gray-200";

  // Glass tinted = wash gradient subtle par-dessus le glass.
  const glassTintCls = variant === "glass" && tint ? GLASS_TINT_BG[tint] : "";

  const paddedCls = padded ? "p-5" : "";

  // Hover lift adapté au variant (shadow plus marquée pour glass).
  const interactiveCls = !interactive
    ? ""
    : variant === "glass" || variant === "frosted"
      ? "cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-glass-md),var(--ring-glass-inset)]"
      : "cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-elevated)] hover:border-gray-300";

  return (
    <div
      className={[base, borderCls, glassTintCls, paddedCls, interactiveCls, className ?? ""]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}

/**
 * Header de Card — eyebrow uppercase + actions à droite.
 * À placer en début de Card padded=false.
 *
 * Option `borderless` (Liquid Glass v2) : retire la border-b et le fond
 * gray-50/40. Pour cards `variant="glass"` ou `"frosted"` où une bordure
 * solide casserait la matière verre.
 */
export function CardHeader({
  title,
  actions,
  borderless = false,
  className,
}: {
  title: ReactNode;
  actions?: ReactNode;
  borderless?: boolean;
  className?: string;
}) {
  const chrome = borderless
    ? "bg-transparent"
    : "border-b border-gray-200 bg-gray-50/40";

  return (
    <div
      className={[
        "flex items-center justify-between px-4 py-2.5",
        chrome,
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">
        {title}
      </p>
      {actions && <div className="flex items-center gap-1">{actions}</div>}
    </div>
  );
}
