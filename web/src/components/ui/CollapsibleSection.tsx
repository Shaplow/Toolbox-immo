"use client";

/**
 * CollapsibleSection — wrapper accordéon pour les sections de fiche.
 *
 * Fermée : pill compact bg-muted + chevron, click n'importe où pour ouvrir.
 * Ouverte : bouton chevron flottant en haut à droite du contenu pour fermer.
 *
 * storageKey persiste l'état. sectionId écoute `pub:open-section` pour
 * ouverture programmatique depuis ProductionChain / header.
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
          className="absolute top-5 right-5 z-10 inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-ring"
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
      className="w-full flex items-center justify-between px-5 py-3 bg-card border border-border rounded-lg hover:bg-muted transition-colors text-left focus-ring"
    >
      <span className="text-[13px] font-semibold text-foreground">{title}</span>
      <ChevronRight size={14} className="text-muted-foreground" />
    </button>
  );
}
