/**
 * GlassBanner — bandeau contextuel sur fond de page (à distinguer de Banner
 * qui sert aux signaux système sticky-top type maintenance/impersonation).
 *
 * Use cases :
 * 1. Banner contexte slot sur /generate/[templateId].
 * 2. Banner contexte slot sur /captions/[id]/generate.
 * 3. Banner contexte slot sur /publications/[id]/cover.
 *
 * Flat shadcn — bg-muted + border-l-4 accent par variant (legacy tints mappés).
 * Nom à terme : Callout (renommage différé pour ne pas casser ~20 call-sites).
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
  action?: ReactNode;
  className?: string;
}

const TINT_ACCENT: Record<GlassBannerTint, string> = {
  peach:   "border-l-warning-600",
  sage:    "border-l-success-600",
  sky:     "border-l-primary",
  rose:    "border-l-danger-600",
  neutral: "border-l-border",
};

const TINT_ICON: Record<GlassBannerTint, string> = {
  peach:   "text-warning-600",
  sage:    "text-success-600",
  sky:     "text-primary",
  rose:    "text-danger-600",
  neutral: "text-muted-foreground",
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
        "flex items-center justify-between gap-3 rounded-md border border-border border-l-4 bg-muted text-foreground",
        TINT_ACCENT[tint],
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
