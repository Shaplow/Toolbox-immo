"use client";

/**
 * CollapsibleSection — wrapper accordéon minimal pour les sections de la fiche publication.
 *
 * Utilisé par PublicationFiche pour replier par défaut les sections non-prioritaires
 * selon le rôle de l'utilisateur courant. L'utilisateur peut toujours ouvrir manuellement.
 *
 * Si `storageKey` est fourni, l'état open/closed est persisté dans localStorage
 * pour que la préférence de l'user soit retenue entre les visites de la même fiche.
 */

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface CollapsibleSectionProps {
  /** Titre affiché dans la barre de collapse (repris du h2 de la section). */
  title: string;
  /** Si true, la section est déplié au montage. */
  defaultOpen?: boolean;
  /** Clé localStorage pour persister l'état open/closed (e.g.
   *  "pub-section:{slotId}:{key}"). Sans cette clé, le state est éphémère. */
  storageKey?: string;
  /**
   * Identifiant de section utilisé pour le force-open externe (B5).
   * Quand un autre composant (ex: ProductionChain) dispatche l'event
   * `pub:open-section` avec ce même `sectionId`, la section s'ouvre
   * automatiquement. Permet à la ProductionChain de scroller vers une
   * section repliée sans laisser l'user devant un bandeau vide.
   */
  sectionId?: string;
  children: React.ReactNode;
}

export function CollapsibleSection({
  title,
  defaultOpen = true,
  storageKey,
  sectionId,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  // Hydrate depuis localStorage si storageKey présent. useEffect pour éviter
  // les mismatchs hydration server/client (window inaccessible côté serveur).
  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(storageKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored === "open") setOpen(true);
      else if (stored === "closed") setOpen(false);
    } catch {
      // localStorage indispo (mode privé Firefox, quotas dépassés) → ignore.
    }
  }, [storageKey]);

  // Persiste à chaque toggle. Useeffect plutôt qu'inline dans le onClick
  // pour rester cohérent avec le state React.
  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, open ? "open" : "closed");
    } catch {
      // localStorage indispo → ignore.
    }
  }, [open, storageKey]);

  // B5 — écoute `pub:open-section` pour s'ouvrir sur demande externe.
  useEffect(() => {
    if (!sectionId || typeof window === "undefined") return;
    function handler(e: Event) {
      const detail = (e as CustomEvent<{ sectionId?: string }>).detail;
      if (detail?.sectionId === sectionId) setOpen(true);
    }
    window.addEventListener("pub:open-section", handler);
    return () => window.removeEventListener("pub:open-section", handler);
  }, [sectionId]);

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
