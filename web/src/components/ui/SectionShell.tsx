/**
 * SectionShell — surface Liquid Glass standard pour les sections de fiche.
 *
 * Doctrine Liquid Glass v2 :
 * - Gradient blanc top → 75%/85% bottom + backdrop-blur léger
 * - Shadow inset spéculaire signature (highlight haut 1px + edge alpha +
 *   bottom subtle + ombre proche douce + ombre lointaine diffuse)
 * - Pas de border-solid : la séparation vient du ring inset
 * - rounded-2xl pour les surfaces majeures, configurable
 *
 * Remplace le pattern duplicaté `bg-white border border-gray-100 rounded-2xl p-8`
 * sur les sections de la fiche publication, et toute future surface de
 * contenu majeure (cards d'admin, panels de drawer, etc.).
 *
 * Pas de "use client" — composant pur de présentation, rendu indifférent.
 */

import type { ReactNode } from "react";

type Padding = "sm" | "md" | "lg";
type Rounded = "lg" | "xl" | "2xl";

interface SectionShellProps {
  id?: string;
  children: ReactNode;
  /** Padding : sm=p-4, md=p-6, lg=p-8 (default lg) */
  padding?: Padding;
  /** Rounded : lg, xl, 2xl (default 2xl) */
  rounded?: Rounded;
  /** Classes additionnelles (override / extension) */
  className?: string;
}

const PADDING_CLS: Record<Padding, string> = {
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
};

const ROUNDED_CLS: Record<Rounded, string> = {
  lg:  "rounded-lg",
  xl:  "rounded-xl",
  "2xl": "rounded-2xl",
};

const GLASS_SURFACE = [
  // Surface plus opaque + brand-tinted top (très subtil peach) pour matière
  // visible sur fond gris-50 quasi-blanc. Sans tint, le glass disparaît dans
  // le fond. La temperature peach signe le brand sans dominer.
  "bg-[linear-gradient(180deg,rgba(255,255,255,1)_0%,rgba(255,245,237,0.6)_35%,rgba(255,255,255,0.78)_100%)]",
  "backdrop-blur-[20px] backdrop-saturate-[1.8]",
  // Ring inset spéculaire visible : highlight haut 1px + edge 0.12α + bottom
  // shadow subtle + 3 ombres extérieures empilées pour vrai flottement.
  "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.12),inset_0_-1px_0_rgba(15,23,42,0.06),0_1px_2px_rgba(15,23,42,0.06),0_12px_28px_-8px_rgba(15,23,42,0.14),0_32px_72px_-24px_rgba(15,23,42,0.18)]",
].join(" ");

export function SectionShell({
  id,
  children,
  padding = "lg",
  rounded = "2xl",
  className,
}: SectionShellProps) {
  return (
    <section
      id={id}
      className={[
        GLASS_SURFACE,
        ROUNDED_CLS[rounded],
        PADDING_CLS[padding],
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </section>
  );
}
