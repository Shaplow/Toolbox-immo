"use client";

/**
 * Barre d'actions groupées sur /fiches.
 *
 * Calquée sur le mode sélection du calendrier (CalendarView) plutôt que sur
 * `useBulkEdit` de la médiathèque : ce dernier est déjà dupliqué deux fois
 * (médias + entrées de données), on ne voulait pas le tripler.
 *
 * Z-index `Z.overlay` et non `z-50` : la barre flotte au-dessus du tableau,
 * mais DOIT passer sous les popovers portalés (Select de réassignation, à 1000).
 */

import { ArchiveRestore, Archive, Trash2, UserCheck, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Z } from "@/lib/ui/zIndex";

export interface EntitiesBulkActionBarProps {
  selectedCount: number;
  /** Nombre de lignes actuellement VISIBLES (filtrées), pas le total. */
  visibleCount: number;
  allVisibleSelected: boolean;
  onToggleAll: (checked: boolean) => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onReassign: () => void;
  onDelete: () => void;
  onClear: () => void;
  busy?: boolean;
}

export function EntitiesBulkActionBar({
  selectedCount,
  visibleCount,
  allVisibleSelected,
  onToggleAll,
  onArchive,
  onUnarchive,
  onReassign,
  onDelete,
  onClear,
  busy = false,
}: EntitiesBulkActionBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-lg"
      style={{ zIndex: Z.overlay }}
    >
      <label className="flex items-center gap-2 cursor-pointer pr-1">
        <Checkbox
          checked={allVisibleSelected ? true : "indeterminate"}
          onChange={onToggleAll}
          size="sm"
          label="Tout sélectionner"
        />
        <span className="text-[12px] tabular-nums text-foreground">
          {selectedCount} sélectionnée{selectedCount > 1 ? "s" : ""}
          {/* Sur les {visibleCount} VISIBLES : « tout sélectionner » ne doit
              jamais déborder sur des lignes masquées par la recherche. */}
          <span className="text-muted-foreground"> / {visibleCount}</span>
        </span>
      </label>

      <span className="h-5 w-px bg-border" aria-hidden />

      <Button size="sm" variant="secondary" icon={UserCheck} onClick={onReassign} disabled={busy}>
        Réassigner
      </Button>
      <Button size="sm" variant="secondary" icon={Archive} onClick={onArchive} disabled={busy}>
        Archiver
      </Button>
      <Button
        size="sm"
        variant="secondary"
        icon={ArchiveRestore}
        onClick={onUnarchive}
        disabled={busy}
      >
        Désarchiver
      </Button>
      <Button size="sm" variant="danger" icon={Trash2} onClick={onDelete} disabled={busy}>
        Supprimer
      </Button>

      <span className="h-5 w-px bg-border" aria-hidden />

      <Button size="sm" variant="ghost" icon={X} onClick={onClear} disabled={busy}>
        <span className="sr-only">Quitter la sélection</span>
      </Button>
    </div>
  );
}
