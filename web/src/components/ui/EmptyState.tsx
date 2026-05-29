"use client";

import { isValidElement, type ReactElement } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "./Button";

/**
 * Empty state avec signature discrète — titre en Caveat (font-hand)
 * pour la touche personnalité. Description Geist en dessous, plus
 * sobre.
 *
 * Pour les empty states résolus (état OK, "Tout est à jour"), utiliser
 * `<HandDrawn.Check />` au lieu d'une icône Lucide.
 *
 * API :
 * - icon : LucideIcon ou ReactElement déjà rendu (utile pour passer un
 *   <HandDrawn.Check /> ou un <Image />).
 * - title : Caveat font-hand par défaut.
 * - description : Geist gray-500.
 * - cta : Button primary size sm.
 */
interface EmptyStateProps {
  icon: LucideIcon | ReactElement;
  title: string;
  description?: string;
  cta?: { label: string; onClick: () => void };
}

export function EmptyState({ icon, title, description, cta }: EmptyStateProps) {
  const iconNode = isValidElement(icon) ? (
    icon
  ) : (
    (() => {
      const Icon = icon as LucideIcon;
      return <Icon size={22} className="text-gray-500" />;
    })()
  );

  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-4 rounded-lg bg-[var(--surface-glass-medium)] backdrop-blur-[12px] backdrop-saturate-150 shadow-[var(--ring-glass-edge),inset_0_0_0_1px_rgba(255,255,255,0.4)] border border-dashed border-gray-200/60">
      <div className="h-11 w-11 rounded-lg bg-white/80 backdrop-blur-[8px] border border-white/60 shadow-[var(--ring-glass-inset)] flex items-center justify-center mb-3">
        {iconNode}
      </div>
      <h3 className="font-hand text-lg text-gray-950 leading-none">{title}</h3>
      {description && (
        <p className="text-[12px] text-gray-500 max-w-sm mt-2 leading-relaxed">
          {description}
        </p>
      )}
      {cta && (
        <div className="mt-4">
          <Button size="sm" onClick={cta.onClick}>
            {cta.label}
          </Button>
        </div>
      )}
    </div>
  );
}
