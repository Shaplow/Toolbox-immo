"use client";

import { isValidElement, type ReactElement } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "./Button";

/**
 * Empty state standard — icône wrapper + titre + description + CTA optionnel.
 *
 * Pour les empty states "signature" (titre Caveat + HandDrawn.Check pour
 * un état résolu), construire le markup directement chez le consommateur
 * — c'est trop spécifique pour passer en API. Voir
 * `/playground/primitives` § "Signature discrète" pour les patterns.
 *
 * - icon : LucideIcon (Client Component) ou ReactElement déjà rendu (Server).
 * - title / description : Geist, sobre, pas de Caveat.
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
      return <Icon size={20} className="text-gray-500" />;
    })()
  );

  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-4 border border-dashed border-gray-200 rounded-lg bg-gray-50/40">
      <div className="h-10 w-10 rounded-md bg-white border border-gray-200 flex items-center justify-center mb-3">
        {iconNode}
      </div>
      <h3 className="text-[13px] font-medium text-gray-950">{title}</h3>
      {description && (
        <p className="text-[12px] text-gray-500 max-w-sm mt-1">{description}</p>
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
