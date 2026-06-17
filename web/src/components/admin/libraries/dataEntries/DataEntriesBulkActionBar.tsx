"use client";

/**
 * DataEntriesBulkActionBar — barre d'action sticky bottom affichée en mode
 * sélection multiple sur les DataEntry.
 *
 * Mirror visuel de MediaAssetsBulkActionBar (mediaAssets/) : bulk Set /
 * catégorie + accès comptes IG. La logique (sélection + handlers) vit dans
 * useBulkEditDataEntries.
 */

import { useState } from "react";
import { Square, CheckSquare, X, Layers, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import type { InstagramAccount } from "@/components/admin/libraries/DataEntriesPanel";
import type { UseBulkEditDataEntriesResult } from "./useBulkEditDataEntries";

interface Props {
  bulk: UseBulkEditDataEntriesResult;
  /** IDs de toutes les entries visibles — utilisé pour "Tout sélectionner". */
  allVisibleIds: string[];
  accounts: InstagramAccount[];
  /** Valeurs de Set existantes — suggestions du Combobox bulk. */
  setTagOptions?: string[];
  /** Catégories existantes — suggestions du Combobox bulk. */
  categoryOptions?: string[];
}

export function DataEntriesBulkActionBar({
  bulk,
  allVisibleIds,
  accounts,
  setTagOptions = [],
  categoryOptions = [],
}: Props) {
  const {
    selectedIds,
    toggleSelect: _toggleSelect,
    selectAll,
    clearSelection,
    bulkApplying,
    handleBulkApplyAccess,
    handleBulkApplyFields,
  } = bulk;

  void _toggleSelect; // exposé par le hook, utilisé dans la spreadsheet

  const [setTagInput, setSetTagInput] = useState("");
  const [categoryInput, setCategoryInput] = useState("");

  const allSelected = allVisibleIds.length > 0 && selectedIds.size === allVisibleIds.length;

  function handleToggleAll() {
    if (allSelected) {
      clearSelection();
    } else {
      selectAll(allVisibleIds);
    }
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 bg-card border border-border border-t border-border/80 shadow-[0_-4px_24px_-4px_rgba(15,23,42,0.12)] px-6 py-3 flex flex-col sm:flex-row items-start sm:items-center gap-3">
      {/* Gauche : compteur + tout sélectionner */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={handleToggleAll}
          className="flex items-center gap-1.5 text-xs text-info-700 hover:underline"
        >
          {allSelected ? <CheckSquare size={12} /> : <Square size={12} />}
          {allSelected ? "Tout désélectionner" : "Tout sélectionner"}
        </button>
        {selectedIds.size > 0 && (
          <span className="text-xs font-semibold text-info-700 bg-info-50 border border-info-200 px-2 py-0.5 rounded-full">
            {selectedIds.size} sélectionné{selectedIds.size > 1 ? "es" : "e"}
          </span>
        )}
      </div>

      {/* Centre : actions (uniquement quand des items sont sélectionnés) */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 flex-1">
          {/* Bulk Set */}
          <div className="flex items-center gap-1">
            <div className="w-[180px]">
              <Combobox
                value={setTagInput}
                onChange={setSetTagInput}
                options={setTagOptions.map((s) => ({ value: s, label: s, icon: Layers }))}
                allowCustom
                placeholder="Set…"
                emptyMessage="Tapez un nom de Set"
                disabled={bulkApplying}
              />
            </div>
            <Button
              variant="secondary"
              size="sm"
              disabled={bulkApplying}
              onClick={() => {
                void handleBulkApplyFields({ setTag: setTagInput });
                setSetTagInput("");
              }}
            >
              Set
            </Button>
          </div>

          {/* Bulk Catégorie */}
          <div className="flex items-center gap-1">
            <div className="w-[180px]">
              <Combobox
                value={categoryInput}
                onChange={setCategoryInput}
                options={categoryOptions.map((c) => ({ value: c, label: c, icon: FolderOpen }))}
                allowCustom
                placeholder="Catégorie…"
                emptyMessage="Tapez une catégorie"
                disabled={bulkApplying}
              />
            </div>
            <Button
              variant="secondary"
              size="sm"
              disabled={bulkApplying}
              onClick={() => {
                void handleBulkApplyFields({ category: categoryInput });
                setCategoryInput("");
              }}
            >
              Cat.
            </Button>
          </div>

          <span className="h-5 w-px bg-border" aria-hidden />

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
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-muted-foreground sm:ml-auto"
      >
        <X size={12} /> Annuler sélection
      </button>
    </div>
  );
}
