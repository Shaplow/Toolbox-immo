/**
 * GlassBanner — bandeau contextuel sur fond de page (à distinguer de Banner
 * qui sert aux signaux système sticky-top type maintenance/impersonation).
 *
 * Use cases :
 * 1. Banner contexte slot sur /generate/[templateId] ("Slot @paris-immo · vendredi 19h").
 * 2. Banner contexte slot sur /captions/[id]/generate ("Transcription en attente").
 * 3. Banner contexte slot sur /publications/[id]/cover ("Cover à choisir").
 *
 * Doctrine Liquid Glass v2 — gradient diagonal pastel + backdrop-blur + ring
 * spéculaire signature. Tint = palette Coastal Studio (peach/sage/sky/rose/
 * neutral). Sizes sm/md/lg pour densité.
 *
 * Avant V2 : ce pattern était copié inline ~20 fois dans /generate, /captions,
 * /listings, /publications/cover, HomeAdmin, etc. avec des paddings/blur
 * légèrement divergents à chaque endroit. GlassBanner consolide.
 */

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type GlassBannerTint = "peach" | "sage" | "sky" | "rose" | "neutral";
export type GlassBannerSize = "sm" | "md" | "lg";

interface GlassBannerProps {
  tint?: GlassBannerTint;
  size?: GlassBannerSize;
  icon?: LucideIcon;
  children: ReactNode;
  /** Action à droite (ex: lien retour, bouton). */
  action?: ReactNode;
  className?: string;
}

const TINT_BG: Record<GlassBannerTint, string> = {
  peach: "from-peach-50/85 to-peach-50/45",
  sage: "from-sage-50/85 to-sage-50/45",
  sky: "from-sky-50/85 to-sky-50/45",
  rose: "from-rose-50/85 to-rose-50/45",
  neutral: "from-white/85 to-white/45",
};

const TINT_TEXT: Record<GlassBannerTint, string> = {
  peach: "text-peach-800",
  sage: "text-sage-800",
  sky: "text-sky-800",
  rose: "text-rose-800",
  neutral: "text-gray-800",
};

const TINT_ICON: Record<GlassBannerTint, string> = {
  peach: "text-peach-600",
  sage: "text-sage-600",
  sky: "text-sky-600",
  rose: "text-rose-600",
  neutral: "text-gray-500",
};

const SIZE_PADDING: Record<GlassBannerSize, string> = {
  sm: "px-3 py-2 text-[12px]",
  md: "px-4 py-3 text-[13px]",
  lg: "px-5 py-4 text-[14px]",
};

export function GlassBanner({
  tint = "neutral",
  size = "md",
  icon: Icon,
  children,
  action,
  className,
}: GlassBannerProps) {
  return (
    <div
      className={[
        "flex items-center justify-between gap-3 rounded-xl",
        "bg-gradient-to-b backdrop-blur-[10px] backdrop-saturate-150",
        "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]",
        TINT_BG[tint],
        TINT_TEXT[tint],
        SIZE_PADDING[size],
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex items-center gap-2 min-w-0">
        {Icon && <Icon size={14} className={`${TINT_ICON[tint]} shrink-0`} />}
        <span className="min-w-0 truncate font-medium">{children}</span>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
