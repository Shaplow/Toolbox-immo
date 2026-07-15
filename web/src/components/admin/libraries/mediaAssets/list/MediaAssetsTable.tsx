"use client";

import { CheckSquare, Square, ChevronUp, ChevronDown } from "lucide-react";
import { MediaAssetRow } from "./MediaAssetRow";
import type { MediaAsset, SortKey } from "../types";

/**
 * MediaAssetsTable — vue liste dense (mode noob) : un tableau triable +
 * sélection multiple, le détail s'ouvre dans le drawer existant au clic.
 * Remplace les vues grille/groupé/rotation pour le mode simple.
 */
export function MediaAssetsTable({
  assets,
  allFilteredIds,
  selectedIds,
  toggleSelect,
  setSelectedIds,
  onOpenDetail,
  sort,
  setSort,
  sentinelRef,
}: {
  assets: MediaAsset[];
  /**
   * Ids de TOUS les assets filtrés (pas seulement la fenêtre rendue `assets`).
   * Le select-all d'en-tête doit porter sur l'ensemble filtré, sinon une action
   * groupée (suppression, édition) ne toucherait que les lignes visibles —
   * incohérent avec le compteur du header et dangereux pour un bulk delete.
   */
  allFilteredIds: string[];
  selectedIds: Set<string>;
  toggleSelect: (id: string) => void;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  onOpenDetail: (asset: MediaAsset) => void;
  sort: SortKey;
  setSort: (s: SortKey) => void;
  sentinelRef: React.Ref<HTMLDivElement>;
}) {
  const allSelected =
    allFilteredIds.length > 0 && allFilteredIds.every((id) => selectedIds.has(id));

  function toggleAll() {
    setSelectedIds((prev) => {
      if (allSelected) {
        const next = new Set(prev);
        allFilteredIds.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...prev, ...allFilteredIds]);
    });
  }

  // En-tête triable Nom / Usage (réutilise le state `sort` du panel).
  const nameActive = sort === "name_asc";
  const usageActive = sort === "usage_desc" || sort === "usage_asc";

  return (
    <div className="rounded-lg border border-border overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-muted/50 text-left text-[11px] font-medium text-muted-foreground">
            <th className="px-2 py-2 w-8">
              <button
                type="button"
                onClick={toggleAll}
                aria-label={allSelected ? "Tout désélectionner" : "Tout sélectionner"}
              >
                {allSelected ? (
                  <CheckSquare size={15} className="text-primary" />
                ) : (
                  <Square size={15} className="text-muted-foreground/50" />
                )}
              </button>
            </th>
            <th className="px-2 py-2 w-12">Aperçu</th>
            <th className="px-2 py-2">
              <button
                type="button"
                onClick={() => setSort("name_asc")}
                className={`inline-flex items-center gap-0.5 hover:text-foreground ${nameActive ? "text-foreground" : ""}`}
              >
                Nom {nameActive && <ChevronDown size={11} />}
              </button>
            </th>
            <th className="px-2 py-2">Catégorie</th>
            <th className="px-2 py-2">Groupe</th>
            <th className="px-2 py-2">Tags</th>
            <th className="px-2 py-2">
              <button
                type="button"
                onClick={() => setSort(sort === "usage_desc" ? "usage_asc" : "usage_desc")}
                className={`inline-flex items-center gap-0.5 hover:text-foreground ${usageActive ? "text-foreground" : ""}`}
              >
                Usage
                {usageActive &&
                  (sort === "usage_desc" ? <ChevronDown size={11} /> : <ChevronUp size={11} />)}
              </button>
            </th>
            <th className="px-2 py-2">Accès</th>
          </tr>
        </thead>
        <tbody>
          {assets.map((asset) => (
            <MediaAssetRow
              key={asset.id}
              asset={asset}
              selected={selectedIds.has(asset.id)}
              onToggleSelect={toggleSelect}
              onOpenDetail={onOpenDetail}
            />
          ))}
        </tbody>
      </table>
      <div ref={sentinelRef} />
    </div>
  );
}
