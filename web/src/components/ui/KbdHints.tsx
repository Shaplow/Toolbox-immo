"use client";

import { KbdChord } from "./Kbd";

export interface KbdHint {
  /** Touches affichées en chips (ex. `["⌘", "K"]`, `["↑"]`, `["J"]`). */
  keys: string[];
  /** Libellé court de l'action (ex. "Suivant", "Rechercher"). */
  label: string;
}

/**
 * Bandeau discret listant les raccourcis actifs dans un contexte donné.
 *
 * Pattern d'usage :
 *   <KbdHints hints={[
 *     { keys: ["↑", "↓"], label: "Naviguer" },
 *     { keys: ["⌘", "O"], label: "Fiche complète" },
 *     { keys: ["Esc"], label: "Fermer" },
 *   ]} />
 *
 * Style : très léger, gris, mono pour les keys. Posé en footer de drawer,
 * palette ou modale.
 */
export function KbdHints({
  hints,
  className,
}: {
  hints: KbdHint[];
  className?: string;
}) {
  if (hints.length === 0) return null;
  return (
    <div
      className={`inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground ${className ?? ""}`}
    >
      {hints.map((h, i) => (
        <span key={`${h.label}-${i}`} className="inline-flex items-center gap-1.5">
          <KbdChord keys={h.keys} size="sm" />
          <span>{h.label}</span>
        </span>
      ))}
    </div>
  );
}
