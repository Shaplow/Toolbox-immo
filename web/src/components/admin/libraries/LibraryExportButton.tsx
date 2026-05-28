"use client";

import { Download } from "lucide-react";

interface Props {
  libraryId: string;
  libraryName: string;
  libraryType: "media" | "data";
}

/**
 * Bouton "Exporter la bibliothèque" — désactivé (à venir).
 *
 * L'export ZIP existant (métadonnées + fichiers R2) n'est pas un cas d'usage
 * actif pour le moment. On garde le placeholder visible pour signaler la
 * future fonctionnalité, sans entretenir le code + le tooling derrière.
 */
export function LibraryExportButton(_props: Props) {
  return (
    <button
      type="button"
      disabled
      title="Export bibliothèque — à venir"
      className="flex items-center gap-1.5 px-3.5 py-2.5 text-gray-300 cursor-not-allowed opacity-60"
    >
      <Download size={14} />
      <span className="text-[10px] uppercase tracking-wide">À venir</span>
    </button>
  );
}
