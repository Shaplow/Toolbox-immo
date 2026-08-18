"use client";

/**
 * DataEntriesBulkActionBar — barre d'action sticky bottom affichée en mode
 * sélection multiple sur les DataEntry.
 *
 * Bâtie sur la primitive partagée BulkActionBar (shared/) — même skeleton
 * que MediaAssetsBulkActionBar (mediaAssets/), qui reste hors périmètre de
 * cette extraction. Regroupe désormais aussi la suppression bulk (avant :
 * barre inline concurrente dans DataEntriesPanel, retirée — deux barres
 * affichées en même temps pour la même sélection). La logique
 * (sélection + handlers) vit dans useBulkEditDataEntries.
 */

import { useState } from "react";
import { Layers, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { BulkActionBar } from "@/components/admin/libraries/shared/BulkActionBar";
import type { InstagramAccount } from "@/components/admin/libraries/DataEntriesPanel";
import type { UseBulkEditDataEntriesResult } from "./useBulkEditDataEntries";

interface Props {
  bulk: UseBulkEditDataEntriesResult;
  /** IDs de toutes les entries visibles — utilisé pour "Tout sélectionner". */
  allVisibleIds: string[];
  accounts: InstagramAccount[];
  /** Valeurs de Dossier existantes — suggestions du Combobox bulk. */
  setTagOptions?: string[];
  /** Supprime les fiches sélectionnées — confirmation + reload gérés par le caller (DataEntriesPanel). */
  onBulkDelete: () => void | Promise<void>;
}

export function DataEntriesBulkActionBar({
  bulk,
  allVisibleIds,
  accounts,
  setTagOptions = [],
  onBulkDelete,
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
  const [deleting, setDeleting] = useState(false);

  const allSelected = allVisibleIds.length > 0 && selectedIds.size === allVisibleIds.length;

  function handleToggleAll() {
    if (allSelected) {
      clearSelection();
    } else {
      selectAll(allVisibleIds);
    }
  }

  async function handleDeleteClick() {
    setDeleting(true);
    try {
      await onBulkDelete();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <BulkActionBar
      selectedCount={selectedIds.size}
      allSelected={allSelected}
      onToggleSelectAll={handleToggleAll}
      onCancel={clearSelection}
    >
      {/* Bulk Dossier */}
      <div className="flex items-center gap-1">
        <div className="w-[180px]">
          <Combobox
            value={setTagInput}
            onChange={setSetTagInput}
            options={setTagOptions.map((s) => ({ value: s, label: s, icon: Layers }))}
            allowCustom
            placeholder="Dossier…"
            emptyMessage="Tapez un nom de dossier"
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
          Dossier
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

      <span className="h-5 w-px bg-border" aria-hidden />

      <Button
        variant="danger"
        size="sm"
        icon={Trash2}
        onClick={() => void handleDeleteClick()}
        disabled={deleting}
        loading={deleting}
      >
        Supprimer
      </Button>
    </BulkActionBar>
  );
}
