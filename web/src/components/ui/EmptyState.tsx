"use client";

import { isValidElement, type ReactElement } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "./Button";

interface EmptyStateProps {
  /**
   * Soit un composant Lucide (ex: `CheckCircle2`) — utilisable depuis un
   * Client Component, soit un élément JSX déjà rendu (ex:
   * `<CheckCircle2 size={20} />`) — obligatoire depuis un Server Component
   * car Next.js refuse de sérialiser les fonctions React à travers la
   * frontière server→client.
   */
  icon: LucideIcon | ReactElement;
  title: string;
  description?: string;
  cta?: { label: string; onClick: () => void };
}

export function EmptyState({ icon, title, description, cta }: EmptyStateProps) {
  const iconNode = isValidElement(icon) ? (
    icon
  ) : (
    // Si on a un LucideIcon (composant fonction), on l'instancie.
    // Note : ce branche n'est pris que si EmptyState est rendu depuis un
    // Client Component — les SC doivent passer un ReactElement directement.
    (() => {
      const Icon = icon as LucideIcon;
      return <Icon size={20} className="text-gray-400" />;
    })()
  );

  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-4 border border-dashed border-gray-200 rounded-xl bg-gray-50/50">
      <div className="w-12 h-12 rounded-xl bg-white border border-gray-200 flex items-center justify-center mb-3">
        {iconNode}
      </div>
      <h3 className="text-sm font-medium text-gray-700 mb-1">{title}</h3>
      {description && <p className="text-xs text-gray-500 max-w-sm mb-3">{description}</p>}
      {cta && (
        <Button variant="primary" size="sm" onClick={cta.onClick}>
          {cta.label}
        </Button>
      )}
    </div>
  );
}
