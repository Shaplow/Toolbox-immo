"use client";

/**
 * CollapsibleSection — wrapper accordéon minimal pour les sections de la fiche publication.
 *
 * Utilisé par PublicationFiche pour replier par défaut les sections non-prioritaires
 * selon le rôle de l'utilisateur courant. L'utilisateur peut toujours ouvrir manuellement.
 */

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface CollapsibleSectionProps {
  /** Titre affiché dans la barre de collapse (repris du h2 de la section). */
  title: string;
  /** Si true, la section est déplié au montage. */
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  if (open) {
    return (
      <div>
        {children}
        {/* Bouton pour replier — discret, en bas à droite de la section */}
        <div className="flex justify-end mt-1">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors py-0.5"
          >
            <ChevronDown size={12} />
            Réduire
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="w-full flex items-center justify-between px-4 py-3 bg-white border border-gray-100 rounded-xl shadow-sm hover:bg-gray-50 transition-colors text-left"
    >
      <span className="text-sm font-medium text-gray-500">{title}</span>
      <span className="inline-flex items-center gap-1 text-xs text-gray-400">
        <ChevronRight size={14} />
        Afficher
      </span>
    </button>
  );
}
