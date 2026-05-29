"use client";

/**
 * CollapsibleSection — wrapper accordéon pour les sections de fiche
 * publication. Persistance optionnelle via localStorage.
 *
 * - Quand ouverte : affiche les children + un petit lien "Réduire" en bas.
 * - Quand fermée : pill cliquable avec eyebrow + chevron + "Afficher".
 * - storageKey : persiste l'état entre les visites de la fiche.
 * - sectionId : permet à un autre composant (ProductionChain) de force
 *   ouvrir via l'event window `pub:open-section`.
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
      <div>
        {children}
        <div className="flex justify-end mt-1">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-700 transition-colors py-0.5 focus-ring rounded"
          >
            <ChevronDown size={11} />
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
      className="w-full flex items-center justify-between px-4 py-2.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-colors text-left focus-ring"
    >
      <span className="text-[13px] font-medium text-gray-700">{title}</span>
      <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
        <ChevronRight size={12} />
        Afficher
      </span>
    </button>
  );
}
