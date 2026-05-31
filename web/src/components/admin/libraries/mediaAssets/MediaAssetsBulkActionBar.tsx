"use client";

/**
 * MediaAssetsBulkActionBar — sticky bar bottom affichée en select mode.
 *
 * Phase D8 du split C1-v2 (plan §19). Le composant ne contient que la
 * UI ; toute la logique (selection + handlers bulk) vit dans le hook
 * useBulkEdit (D4). Le bar reçoit le `bulk` result + la liste `filtered`
 * pour le "tout sélectionner".
 */

import { Square, CheckSquare, X, Trash2 } from "lucide-react";
import type { MediaAsset, InstagramAccount } from "./types";
import type { UseBulkEditResult } from "./useBulkEdit";

interface Props {
  bulk: UseBulkEditResult;
  /** Liste filtrée actuellement visible — utilisée pour "Tout sélectionner". */
  filtered: MediaAsset[];
  accounts: InstagramAccount[];
}

export function MediaAssetsBulkActionBar({ bulk, filtered, accounts }: Props) {
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
    bulkError,
    bulkSuccess,
    exitSelectMode,
    handleBulkApplySetTag,
    handleBulkApplyTags,
    handleBulkApplyAccess,
    handleBulkApplyCategory,
    handleBulkDelete,
  } = bulk;

  const allSelected = selectedIds.size === filtered.length && filtered.length > 0;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-200 shadow-lg px-6 py-3 flex flex-col sm:flex-row items-start sm:items-center gap-3">
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
          className="flex items-center gap-1.5 text-xs text-sky-800 hover:underline"
        >
          {allSelected ? <CheckSquare size={12} /> : <Square size={12} />}
          {allSelected ? "Tout désélectionner" : "Tout sélectionner"}
        </button>
        {selectedIds.size > 0 && (
          <span className="text-xs font-semibold text-sky-800 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded-full">
            {selectedIds.size} sélectionné{selectedIds.size > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Center: actions (only when items are selected) */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 flex-1">
          {/* Bulk category */}
          <div className="flex items-center gap-1">
            <input
              value={bulkCategoryInput}
              onChange={(e) => setBulkCategoryInput(e.target.value)}
              list="group-list"
              placeholder="Catégorie…"
              className="w-28 text-xs border border-rose-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-rose-400"
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
          {/* Bulk pack */}
          <div className="flex items-center gap-1">
            <input
              value={bulkSetTagInput}
              onChange={(e) => setBulkSetTagInput(e.target.value)}
              list="bulk-set-tags-list"
              placeholder="Pack…"
              className="w-28 text-xs border border-rose-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-pink-400"
              onKeyDown={(e) => { if (e.key === "Enter") { void handleBulkApplySetTag(); } }}
            />
            <button
              onClick={() => { void handleBulkApplySetTag(); }}
              disabled={bulkApplying}
              className={`px-2.5 py-1 text-white text-xs rounded disabled:opacity-50 ${
                bulkSetTagInput.trim() ? "bg-rose-600 hover:bg-rose-700" : "bg-gray-400 hover:bg-gray-500"
              }`}
              title={bulkSetTagInput.trim() ? "Appliquer le pack" : "Retirer le pack"}
            >
              {bulkSetTagInput.trim() ? "Pack" : <X size={10} />}
            </button>
          </div>
          {/* Bulk tags */}
          <div className="flex items-center gap-1">
            <input
              value={bulkTagsInput}
              onChange={(e) => setBulkTagsInput(e.target.value)}
              placeholder="Tags (virgule)…"
              className="w-36 text-xs border border-sky-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-sky-400"
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
                className="text-xs border border-blue-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 text-gray-600 disabled:opacity-50 max-w-[130px]"
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
          {bulkError && <p className="text-xs text-red-500">{bulkError}</p>}
          {bulkSuccess && <p className="text-xs text-green-600">{bulkSuccess}</p>}
        </div>
      )}

      {/* Right: cancel */}
      <button
        onClick={exitSelectMode}
        className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 sm:ml-auto"
      >
        <X size={12} /> Annuler
      </button>
    </div>
  );
}
