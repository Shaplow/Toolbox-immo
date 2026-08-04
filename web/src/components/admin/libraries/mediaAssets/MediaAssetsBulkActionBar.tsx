"use client";

/**
 * MediaAssetsBulkActionBar — sticky bar bottom affichée en select mode.
 *
 * Phase D8 du split C1-v2 (plan §19). Le composant ne contient que la
 * UI ; toute la logique (selection + handlers bulk) vit dans le hook
 * useBulkEdit (D4). Le bar reçoit le `bulk` result + la liste `filtered`
 * pour le "tout sélectionner".
 */

import { Square, CheckSquare, X, Trash2, Download } from "lucide-react";
import type { MediaAsset, InstagramAccount } from "./types";
import type { UseBulkEditResult } from "./useBulkEdit";
import { downloadAssets } from "./downloadAssets";
import { useMediaLibraryPermissions } from "./mediaLibraryPermissions";

interface Props {
  bulk: UseBulkEditResult;
  /** Liste filtrée actuellement visible — utilisée pour "Tout sélectionner". */
  filtered: MediaAsset[];
  accounts: InstagramAccount[];
}

export function MediaAssetsBulkActionBar({ bulk, filtered, accounts }: Props) {
  const { canManageAssets } = useMediaLibraryPermissions();
  const {
    selectedIds,
    setSelectedIds,
    bulkSetTagInput,
    setBulkSetTagInput,
    bulkTagsInput,
    setBulkTagsInput,
    bulkCategoryInput,
    setBulkCategoryInput,
    bulkApplying,
    exitSelectMode,
    handleBulkApplySetTag,
    handleBulkApplyTags,
    handleBulkApplyAccess,
    handleBulkApplyCategory,
    handleBulkDelete,
  } = bulk;

  const allSelected = selectedIds.size === filtered.length && filtered.length > 0;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-border shadow-lg px-6 py-3 flex flex-col sm:flex-row items-start sm:items-center gap-3">
      {/* Left: count + select-all */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => {
            if (allSelected) {
              setSelectedIds(new Set());
            } else {
              setSelectedIds(new Set(filtered.map((a) => a.id)));
            }
          }}
          className="flex items-center gap-1.5 text-xs text-info-700 hover:underline"
        >
          {allSelected ? <CheckSquare size={12} /> : <Square size={12} />}
          {allSelected ? "Tout désélectionner" : "Tout sélectionner"}
        </button>
        {selectedIds.size > 0 && (
          <span className="text-xs font-semibold text-info-700 bg-info-50 border border-info-200 px-2 py-0.5 rounded-full">
            {selectedIds.size} sélectionné{selectedIds.size > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Center: actions (only when items are selected) */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 flex-1">
          {/* Télécharger — en tête : c'est la seule action non destructive, et la
              seule dont dispose un rôle en lecture seule. */}
          <button
            onClick={() => {
              const selected = filtered.filter((a) => selectedIds.has(a.id));
              void downloadAssets(selected.map((a) => ({ id: a.id, filename: a.filename })));
            }}
            className="flex items-center gap-1 px-2.5 py-1 border border-info-200 text-info-700 text-xs rounded hover:bg-info-50 transition-colors"
            title={`Télécharger les ${selectedIds.size} fichiers sélectionnés`}
          >
            <Download size={11} /> Télécharger ({selectedIds.size})
          </button>
          {/* Actions mutantes — masquées en lecture seule : la barre se réduit
              alors à « tout sélectionner » + « Télécharger » + « Annuler ». */}
          {canManageAssets && (
            <>
          {/* W5.11 : couleurs alignées sur Coastal Studio (sage pour
              category/pack actions non-destructives — rose réservé au danger). */}
          {/* Bulk category */}
          <div className="flex items-center gap-1">
            <input
              value={bulkCategoryInput}
              onChange={(e) => setBulkCategoryInput(e.target.value)}
              list="group-list"
              placeholder="Catégorie…"
              className="w-28 text-xs border border-success-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-success-200"
              onKeyDown={(e) => { if (e.key === "Enter") { void handleBulkApplyCategory(); } }}
            />
            <button
              onClick={() => { void handleBulkApplyCategory(); }}
              disabled={bulkApplying}
              className={`px-2.5 py-1 text-white text-xs rounded disabled:opacity-50 ${
                bulkCategoryInput.trim() ? "bg-gray-900 hover:bg-gray-700" : "bg-gray-400 hover:bg-gray-500"
              }`}
              title={bulkCategoryInput.trim() ? "Appliquer la catégorie" : "Retirer la catégorie"}
            >
              {bulkCategoryInput.trim() ? "Cat." : <X size={10} />}
            </button>
          </div>
          {/* Bulk groupe */}
          <div className="flex items-center gap-1">
            <input
              value={bulkSetTagInput}
              onChange={(e) => setBulkSetTagInput(e.target.value)}
              list="bulk-set-tags-list"
              placeholder="Groupe…"
              className="w-28 text-xs border border-success-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-success-200"
              onKeyDown={(e) => { if (e.key === "Enter") { void handleBulkApplySetTag(); } }}
            />
            <button
              onClick={() => { void handleBulkApplySetTag(); }}
              disabled={bulkApplying}
              className={`px-2.5 py-1 text-white text-xs rounded disabled:opacity-50 ${
                bulkSetTagInput.trim() ? "bg-gray-900 hover:bg-gray-700" : "bg-gray-400 hover:bg-gray-500"
              }`}
              title={bulkSetTagInput.trim() ? "Appliquer le groupe" : "Retirer le groupe"}
            >
              {bulkSetTagInput.trim() ? "Groupe" : <X size={10} />}
            </button>
          </div>
          {/* Bulk tags */}
          <div className="flex items-center gap-1">
            <input
              value={bulkTagsInput}
              onChange={(e) => setBulkTagsInput(e.target.value)}
              placeholder="Tags (virgule)…"
              className="w-36 text-xs border border-info-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-info-200"
              onKeyDown={(e) => { if (e.key === "Enter") { void handleBulkApplyTags(); } }}
            />
            <button
              onClick={() => { void handleBulkApplyTags(); }}
              disabled={bulkApplying}
              className={`px-2.5 py-1 text-white text-xs rounded disabled:opacity-50 ${
                bulkTagsInput.trim() ? "bg-gray-900 hover:bg-gray-700" : "bg-gray-400 hover:bg-gray-500"
              }`}
              title={bulkTagsInput.trim() ? "Appliquer les tags" : "Retirer les tags"}
            >
              {bulkTagsInput.trim() ? "Tags" : <X size={10} />}
            </button>
          </div>
          {/* Bulk access */}
          {accounts.length > 0 && (
            <div className="flex items-center gap-1">
              <select
                defaultValue=""
                onChange={(e) => {
                  const val = e.target.value;
                  e.target.value = "";
                  if (!val) return;
                  if (val === "__global__") { void handleBulkApplyAccess("remove_all"); }
                  else { void handleBulkApplyAccess("add", val); }
                }}
                disabled={bulkApplying}
                className="text-xs border border-info-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-info-200 text-muted-foreground disabled:opacity-50 max-w-[130px]"
              >
                <option value="">Compte IG…</option>
                <option value="__global__">🌍 Global (tous)</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>@{a.handle}</option>
                ))}
              </select>
            </div>
          )}
          {/* Bulk delete */}
          <button
            onClick={() => { void handleBulkDelete(); }}
            disabled={bulkApplying}
            className="flex items-center gap-1 px-2.5 py-1 border border-red-200 text-red-600 text-xs rounded hover:bg-red-50 disabled:opacity-50"
          >
            <Trash2 size={11} /> Supprimer
          </button>
            </>
          )}
          {/* W4.5 : bulkError/bulkSuccess remplacés par toast.error/success
              côté useBulkEdit — feedback en overlay cohérent avec le reste
              de l'app au lieu d'un texte inline dans une barre déjà dense. */}
        </div>
      )}

      {/* Right: cancel */}
      <button
        onClick={exitSelectMode}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-muted-foreground sm:ml-auto"
      >
        <X size={12} /> Annuler
      </button>
    </div>
  );
}
