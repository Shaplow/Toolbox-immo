"use client";

/**
 * MediaAssetsGroupedView — vue "grouped" (Dossiers) du MediaAssetsPanel.
 *
 * Plan simplification 2026-08 : plus de catégories, plus d'ordre de
 * rotation personnalisé. La vue affiche une grille de dossiers (setTag) —
 * un bloc par dossier + un bloc « (sans dossier) » pour les assets sans
 * setTag, en colonnes détaillées (MediaAssetsGroupColumn) via `renderColumn`.
 *
 * Seule accessible en mode avancé (le mode simple forçait `useListView` dans
 * MediaAssetsPanel, ce qui rendait la branche "stacks" de ce composant
 * injoignable — retirée lors de la purge du 2026-08).
 */

import type { SetGroup } from "./types";

interface Props {
  groupedBySetTag: SetGroup[];
  renderColumn: (group: SetGroup & { fluid?: boolean }) => React.ReactNode;
}

export function MediaAssetsGroupedView({ groupedBySetTag, renderColumn }: Props) {
  if (groupedBySetTag.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Aucun résultat.</p>;
  }

  return (
    <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
      {groupedBySetTag.map((g) => renderColumn({ ...g, fluid: true }))}
    </div>
  );
}
