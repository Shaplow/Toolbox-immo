"use client";

/**
 * Chip — tag pill compact avec option de suppression.
 *
 * À distinguer de Badge : un Chip est ACTIONNABLE (cliquable, removable),
 * un Badge est purement informatif. Use cases : filtres actifs, tags
 * sélectionnés dans un Combobox, catégories.
 *
 * Doctrine Liquid Glass v2 :
 * - Background tinted par variant + ring inset signature.
 * - Bouton X intégré si onRemove fourni — focus ring séparé.
 * - Icône optionnelle à gauche.
 *
 * Variants : default | peach | sage | sky | rose (Coastal Studio).
 * Sizes : sm (h-5) | md (h-6, default).
 */

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { X } from "lucide-react";

type Variant = "default" | "peach" | "sage" | "sky" | "rose";
type Size = "sm" | "md";

interface ChipProps {
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  /** Si fourni, affiche un bouton X et appelle onRemove au click. */
  onRemove?: () => void;
  /** Rend le chip cliquable (cursor + hover + onClick). */
  onClick?: () => void;
  /** Chip sélectionné (état "actif" si interactive). */
  selected?: boolean;
  className?: string;
  /** Identifiant stable pour les tests E2E / audits Playwright. Rendu en
   *  `data-testid` sur le <span> racine. */
  testId?: string;
}

const VARIANT_CLS: Record<Variant, { base: string; selected: string; remove: string }> = {
  default: {
    base:     "bg-white/60 text-gray-700",
    selected: "bg-gray-100/80 text-gray-950",
    remove:   "hover:bg-gray-200/70 hover:text-gray-950",
  },
  peach: {
    base:     "bg-peach-50/70 text-peach-700",
    selected: "bg-peach-100/80 text-peach-700",
    remove:   "hover:bg-peach-100/80 hover:text-peach-700",
  },
  sage: {
    base:     "bg-sage-50/70 text-sage-700",
    selected: "bg-sage-100/80 text-sage-700",
    remove:   "hover:bg-sage-100/80 hover:text-sage-700",
  },
  sky: {
    base:     "bg-sky-50/70 text-sky-700",
    selected: "bg-sky-100/80 text-sky-700",
    remove:   "hover:bg-sky-100/80 hover:text-sky-700",
  },
  rose: {
    base:     "bg-rose-50/70 text-rose-700",
    selected: "bg-rose-100/80 text-rose-700",
    remove:   "hover:bg-rose-100/80 hover:text-rose-700",
  },
};

export function Chip({
  children,
  variant = "default",
  size = "md",
  icon: Icon,
  onRemove,
  onClick,
  selected = false,
  className,
  testId,
}: ChipProps) {
  const styles = VARIANT_CLS[variant];
  const sizeCls = size === "sm" ? "h-5 text-[11px]" : "h-6 text-[12px]";
  const iconSize = size === "sm" ? 10 : 12;
  const padX = onRemove ? "pl-2 pr-0.5" : "px-2";

  const interactive = !!onClick;

  return (
    <span
      className={[
        "inline-flex items-center gap-1 rounded-full backdrop-blur-[8px] backdrop-saturate-150 transition-colors leading-none",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(15,23,42,0.06)]",
        sizeCls,
        padX,
        selected ? styles.selected : styles.base,
        interactive ? "cursor-pointer hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.1)]" : "",
        className ?? "",
      ].filter(Boolean).join(" ")}
      onClick={onClick}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); } } : undefined}
      data-testid={testId}
    >
      {Icon && <Icon size={iconSize} className="shrink-0" />}
      <span className="font-medium">{children}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className={`shrink-0 inline-flex items-center justify-center h-4 w-4 rounded-full transition-colors focus-ring ${styles.remove}`}
          aria-label="Retirer"
        >
          <X size={iconSize - 2} />
        </button>
      )}
    </span>
  );
}
