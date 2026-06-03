"use client";

/**
 * DataEntriesBulkActionBar — barre d'action sticky bottom affichée en mode
 * sélection multiple sur les DataEntry.
 *
 * Mirror visuel de MediaAssetsBulkActionBar (mediaAssets/) mais scope
 * access-only : ajouter / retirer des accès comptes IG.
 * La logique (sélection + handlers) vit dans useBulkEditDataEntries.
 */

import { Square, CheckSquare, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import type { InstagramAccount } from "@/components/admin/libraries/DataEntriesPanel";
import type { UseBulkEditDataEntriesResult } from "./useBulkEditDataEntries";

interface Props {
  bulk: UseBulkEditDataEntriesResult;
  /** IDs de toutes les entries visibles — utilisé pour "Tout sélectionner". */
  allVisibleIds: string[];
  accounts: InstagramAccount[];
}

export function DataEntriesBulkActionBar({ bulk, allVisibleIds, accounts }: Props) {
  const {
    selectedIds,
    toggleSelect: _toggleSelect,
    selectAll,
    clearSelection,
    bulkApplying,
    handleBulkApplyAccess,
  } = bulk;

  void _toggleSelect; // exposé par le hook, utilisé dans la spreadsheet

  const allSelected = allVisibleIds.length > 0 && selectedIds.size === allVisibleIds.length;

  function handleToggleAll() {
    if (allSelected) {
      clearSelection();
    } else {
      selectAll(allVisibleIds);
    }
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-[8px] border-t border-gray-200/80 shadow-[0_-4px_24px_-4px_rgba(15,23,42,0.12)] px-6 py-3 flex flex-col sm:flex-row items-start sm:items-center gap-3">
      {/* Gauche : compteur + tout sélectionner */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={handleToggleAll}
          className="flex items-center gap-1.5 text-xs text-sky-800 hover:underline"
        >
          {allSelected ? <CheckSquare size={12} /> : <Square size={12} />}
          {allSelected ? "Tout désélectionner" : "Tout sélectionner"}
        </button>
        {selectedIds.size > 0 && (
          <span className="text-xs font-semibold text-sky-800 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded-full">
            {selectedIds.size} sélectionné{selectedIds.size > 1 ? "es" : "e"}
          </span>
        )}
      </div>

      {/* Centre : actions (uniquement quand des items sont sélectionnés) */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 flex-1">
          {/* Sélecteur compte IG pour add */}
          {accounts.length > 0 && (
            <div className="w-[220px]">
              <Combobox
                value=""
                onChange={(accountId) => {
                  if (!accountId) return;
                  void handleBulkApplyAccess("add", accountId);
                }}
                options={accounts.map((a) => ({
                  value: a.id,
                  label: `@${a.handle} — ${a.name}`,
                  keywords: [a.handle, a.name],
                }))}
                placeholder="Ajouter un compte…"
                emptyMessage="Aucun compte"
                disabled={bulkApplying}
              />
            </div>
          )}

          {/* Retirer tous les accès → global */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleBulkApplyAccess("remove_all")}
            disabled={bulkApplying}
            loading={bulkApplying}
          >
            Retirer tous accès
          </Button>
        </div>
      )}

      {/* Droite : annuler */}
      <button
        type="button"
        onClick={clearSelection}
        className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 sm:ml-auto"
      >
        <X size={12} /> Annuler sélection
      </button>
    </div>
  );
}
