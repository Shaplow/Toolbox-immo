"use client";

/**
 * CollapsibleSection — wrapper accordéon pour les sections de fiche.
 *
 * UX :
 * - Quand fermée : pill compact avec titre + chevron, click n'importe où
 *   pour ouvrir. Liquid Glass v2 : surface-glass-faint + backdrop-blur
 *   pour rappeler la matière flottante.
 * - Quand ouverte : un mini bouton chevron flottant en haut à droite du
 *   contenu permet de la refermer. Pas de lien "Réduire" qui prend une
 *   ligne entière en bas.
 * - storageKey : persiste l'état entre les visites de la fiche.
 * - sectionId : permet à un autre composant (ProductionChain, header)
 *   d'ouvrir via event window `pub:open-section`.
 *
 * Sticky header au scroll : à implémenter en Phase 6 (refonte fiche pub).
 * Nécessite IntersectionObserver + portail header — hors scope Phase 2.
 */

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  storageKey?: string;
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

  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(storageKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored === "open") setOpen(true);
      else if (stored === "closed") setOpen(false);
    } catch {
      // localStorage indispo → ignore.
    }
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, open ? "open" : "closed");
    } catch {
      // localStorage indispo → ignore.
    }
  }, [open, storageKey]);

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
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={`Réduire ${title}`}
          title={`Réduire ${title}`}
          className="absolute top-5 right-5 z-10 inline-flex h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors focus-ring"
        >
          <ChevronDown size={14} />
        </button>
        {children}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="w-full flex items-center justify-between px-5 py-3 bg-[var(--surface-glass-faint)] backdrop-blur-[8px] backdrop-saturate-150 border border-white/50 rounded-2xl hover:bg-[var(--surface-glass-medium)] hover:border-gray-200 transition-colors text-left focus-ring shadow-[var(--ring-glass-edge)]"
    >
      <span className="text-[13px] font-semibold text-gray-700">{title}</span>
      <ChevronRight size={14} className="text-gray-400" />
    </button>
  );
}
