"use client";

/**
 * MediaAssetsGroupedView — vue "grouped" (Dossiers) du MediaAssetsPanel.
 *
 * Plan simplification 2026-08 : plus de catégories, plus d'ordre de
 * rotation personnalisé. La vue affiche une grille de dossiers (setTag) —
 * un bloc par dossier + un bloc « (sans dossier) » pour les assets sans
 * setTag. Mode avancé : colonnes détaillées (MediaAssetsGroupColumn) via
 * `renderColumn`. Mode simple : stacks visuelles (MediaAssetsSetStack).
 */

import type { SetGroup } from "./types";
import { MediaAssetsSetStack } from "./MediaAssetsSetStack";

interface Props {
  groupedBySetTag: SetGroup[];
  accountFilter: string | null;
  renderColumn: (group: SetGroup & { fluid?: boolean }) => React.ReactNode;
  /** Mode avancé : grille classique avec colonnes détaillées. Mode simple : stacks visuelles par dossier. */
  isAdvanced: boolean;
  /** Callback ouverture détail d'un dossier (mode simple seulement, ouvre le 1er asset). */
  onOpenSet?: (group: SetGroup) => void;
}

export function MediaAssetsGroupedView({
  groupedBySetTag,
  accountFilter,
  renderColumn,
  isAdvanced,
  onOpenSet,
}: Props) {
  if (groupedBySetTag.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Aucun résultat.</p>;
  }

  return isAdvanced ? (
    <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
      {groupedBySetTag.map((g) => renderColumn({ ...g, fluid: true }))}
    </div>
  ) : (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
      {groupedBySetTag.map((g) => (
        <MediaAssetsSetStack
          key={g.key}
          group={g}
          accountFilter={accountFilter}
          onClick={() => onOpenSet?.(g)}
        />
      ))}
    </div>
  );
}
