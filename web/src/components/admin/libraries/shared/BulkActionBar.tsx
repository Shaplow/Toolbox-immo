"use client";

/**
 * BulkActionBar — skeleton commun d'une barre sticky bottom de sélection
 * multiple : gauche (tout sélectionner + compteur), centre (actions du
 * caller, rendues seulement si une sélection existe), droite (annuler).
 *
 * Extrait de DataEntriesBulkActionBar (dataEntries/), qui se décrivait comme
 * un « mirror visuel » de MediaAssetsBulkActionBar (mediaAssets/) — ce
 * dernier reste sur son implémentation historique (raw <input>/<select>,
 * hors périmètre de cette extraction) ; le brancher sur cette primitive est
 * un chantier séparé.
 */

import { Square, CheckSquare, X } from "lucide-react";
import type { ReactNode } from "react";

interface BulkActionBarProps {
  selectedCount: number;
  allSelected: boolean;
  onToggleSelectAll: () => void;
  onCancel: () => void;
  cancelLabel?: string;
  /** Libellé du badge de comptage. Défaut : accord féminin ("N sélectionnée(s)"). */
  countLabel?: (count: number) => string;
  /** Actions centrales (boutons, combobox…) — rendues uniquement si selectedCount > 0. */
  children?: ReactNode;
}

function defaultCountLabel(count: number): string {
  return `${count} sélectionné${count > 1 ? "es" : "e"}`;
}

export function BulkActionBar({
  selectedCount,
  allSelected,
  onToggleSelectAll,
  onCancel,
  cancelLabel = "Annuler sélection",
  countLabel = defaultCountLabel,
  children,
}: BulkActionBarProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 bg-card border border-border border-t border-border/80 shadow-[0_-4px_24px_-4px_rgba(15,23,42,0.12)] px-6 py-3 flex flex-col sm:flex-row items-start sm:items-center gap-3">
      {/* Gauche : compteur + tout sélectionner */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onToggleSelectAll}
          className="flex items-center gap-1.5 text-xs text-info-700 hover:underline"
        >
          {allSelected ? <CheckSquare size={12} /> : <Square size={12} />}
          {allSelected ? "Tout désélectionner" : "Tout sélectionner"}
        </button>
        {selectedCount > 0 && (
          <span className="text-xs font-semibold text-info-700 bg-info-50 border border-info-200 px-2 py-0.5 rounded-full">
            {countLabel(selectedCount)}
          </span>
        )}
      </div>

      {/* Centre : actions (uniquement quand des items sont sélectionnés) */}
      {selectedCount > 0 && children && (
        <div className="flex flex-wrap items-center gap-2 flex-1">{children}</div>
      )}

      {/* Droite : annuler */}
      <button
        type="button"
        onClick={onCancel}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-muted-foreground sm:ml-auto"
      >
        <X size={12} /> {cancelLabel}
      </button>
    </div>
  );
}
