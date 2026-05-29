"use client";

/**
 * EmptyHero — empty state grand format pour pages vides.
 *
 * À distinguer d'<EmptyState> (inline dans une carte/section).
 * EmptyHero est destiné aux pages entières où il n'y a rien à afficher :
 * - /listings sans listings
 * - /tools/captions vide
 * - /admin/libraries sans library
 * - dashboards vides
 *
 * Doctrine Liquid Glass v2 :
 * - Container centré, padding généreux.
 * - Illustration ou icône grand format (wrapper glass-strong + ring inset
 *   + halo extérieur diffus).
 * - Title font-hand text-3xl (signature discrète Toolbox autorisée ici —
 *   les empty hero sont des "moments" signature).
 * - Description Geist sobre.
 * - CTA(s) en bas.
 */

import { isValidElement, type ReactElement, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

interface EmptyHeroProps {
  /** Icône Lucide OU élément déjà rendu (Image, Sparkle, etc.). */
  icon: LucideIcon | ReactElement;
  /** Titre — affiché en font-hand text-3xl signature. */
  title: string;
  /** Description Geist sobre sous le titre. */
  description?: ReactNode;
  /** Action principale (Button primary). */
  cta?: ReactNode;
  /** Actions secondaires (alignées à droite du cta). */
  secondaryActions?: ReactNode;
  /** Padding vertical du container. Default "lg". */
  padding?: "md" | "lg" | "xl";
  className?: string;
}

const PADDING_CLS = {
  md: "py-12",
  lg: "py-20",
  xl: "py-28",
};

export function EmptyHero({
  icon,
  title,
  description,
  cta,
  secondaryActions,
  padding = "lg",
  className,
}: EmptyHeroProps) {
  const iconNode = isValidElement(icon)
    ? icon
    : (() => {
        const Icon = icon as LucideIcon;
        return <Icon size={32} className="text-gray-600" strokeWidth={1.5} />;
      })();

  return (
    <div
      className={[
        "flex flex-col items-center text-center px-6",
        PADDING_CLS[padding],
        className ?? "",
      ].filter(Boolean).join(" ")}
    >
      {/* Wrapper icône grand format glass-strong + halo */}
      <div
        className={[
          "inline-flex h-20 w-20 items-center justify-center rounded-2xl mb-6",
          "bg-gradient-to-b from-white to-white/80 backdrop-blur-[16px] backdrop-saturate-150",
          "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.5),inset_0_-1px_0_rgba(15,23,42,0.06),0_2px_8px_-2px_rgba(15,23,42,0.08),0_24px_56px_-12px_rgba(15,23,42,0.18)]",
        ].join(" ")}
        aria-hidden
      >
        {iconNode}
      </div>

      <h2 className="font-hand text-3xl text-gray-950 leading-none">
        {title}
      </h2>

      {description && (
        <p className="text-[13px] text-gray-600 max-w-md mt-3 leading-relaxed">
          {description}
        </p>
      )}

      {(cta || secondaryActions) && (
        <div className="mt-6 flex flex-col sm:flex-row items-center gap-2">
          {cta}
          {secondaryActions}
        </div>
      )}
    </div>
  );
}
