"use client";

/**
 * MediaAssetsAudioList — vue list pour les bibliothèques audio.
 *
 * Phase D9 (préparation wrapper fin) du split C1-v2 (plan §19). Cette vue
 * affiche les musiques en list view avec inline edit usage + tags, audio
 * player HTML5, reset/delete actions.
 *
 * Le parent (MediaAssetsPanel) garde le contrôle des states d'inline
 * editing (editingUsageId, editingTagsId, usageInput, tagInput) et des
 * handlers de save/reset/delete. La vue les reçoit en props.
 */

import { Download, Music2, RotateCcw, Tag, Trash2 } from "lucide-react";
import type { MediaAsset } from "./types";
import { formatDate, formatDuration } from "./helpers";
import { downloadAsset } from "./downloadAssets";
import { useMediaLibraryPermissions } from "./mediaLibraryPermissions";

interface Props {
  assets: MediaAsset[];
  accountFilter: string | null;
  editingUsageId: string | null;
  usageInput: string;
  setEditingUsageId: (id: string | null) => void;
  setUsageInput: (v: string) => void;
  handleSaveUsage: (asset: MediaAsset, raw: string) => Promise<void>;
  editingTagsId: string | null;
  tagInput: string;
  setEditingTagsId: (id: string | null) => void;
  setTagInput: (v: string) => void;
  handleSaveTags: (asset: MediaAsset, newTags: string[]) => Promise<void>;
  handleResetAssetUsage: (asset: MediaAsset) => Promise<void>;
  handleDelete: (asset: MediaAsset) => Promise<void>;
}

export function MediaAssetsAudioList({
  assets,
  accountFilter,
  editingUsageId,
  usageInput,
  setEditingUsageId: rawSetEditingUsageId,
  setUsageInput,
  handleSaveUsage,
  editingTagsId,
  tagInput,
  setEditingTagsId: rawSetEditingTagsId,
  setTagInput,
  handleSaveTags,
  handleResetAssetUsage,
  handleDelete,
}: Props) {
  const { canManageAssets } = useMediaLibraryPermissions();

  // Lecture seule : l'entrée en édition inline est inerte (cf. MediaAssetsVideoCard).
  const noEdit = <T extends (...args: never[]) => void>(fn: T): T =>
    (canManageAssets ? fn : () => {}) as T;
  const setEditingUsageId = noEdit(rawSetEditingUsageId);
  const setEditingTagsId = noEdit(rawSetEditingTagsId);

  return (
    <div className="space-y-1.5">
      {assets.map((asset) => (
        <div
          key={asset.id}
          className="group flex items-center gap-3 p-3 bg-white border border-border rounded-xl hover:border-info-200 transition-colors"
        >
          <div className="w-9 h-9 bg-info-50 rounded-lg flex items-center justify-center shrink-0">
            <Music2 size={16} className="text-info-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{asset.filename}</p>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              {asset.duration ? <span>{formatDuration(asset.duration)}</span> : null}
              {editingUsageId === asset.id ? (
                <input
                  autoFocus
                  type="number"
                  min={0}
                  value={usageInput}
                  onChange={(e) => setUsageInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleSaveUsage(asset, usageInput);
                    if (e.key === "Escape") {
                      setEditingUsageId(null);
                      setUsageInput("");
                    }
                  }}
                  onBlur={() => void handleSaveUsage(asset, usageInput)}
                  className="w-16 text-[10px] border border-info-200 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-info-200"
                />
              ) : (
                <button
                  onClick={() => {
                    setEditingUsageId(asset.id);
                    setUsageInput(String(asset.usageCount));
                  }}
                  className="flex items-center gap-0.5 hover:text-info-700 hover:underline transition-colors"
                  title="Cliquer pour modifier"
                >
                  {asset.usageCount} usage{asset.usageCount !== 1 ? "s" : ""}
                </button>
              )}
              <span>· Dernier : {formatDate(asset.lastUsedAt)}</span>
            </div>
            {/* Tags */}
            {editingTagsId === asset.id ? (
              <input
                autoFocus
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void handleSaveTags(asset, tagInput.split(",").map((t) => t.trim()).filter(Boolean));
                  }
                  if (e.key === "Escape") {
                    setEditingTagsId(null);
                    setTagInput("");
                  }
                }}
                onBlur={() => void handleSaveTags(asset, tagInput.split(",").map((t) => t.trim()).filter(Boolean))}
                placeholder="tag1, tag2"
                className="mt-1 w-full text-[10px] border border-info-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-info-200"
              />
            ) : (
              <div
                className="mt-1 flex flex-wrap gap-1 cursor-pointer min-h-[16px]"
                onClick={() => {
                  setEditingTagsId(asset.id);
                  setTagInput(asset.tags.join(", "));
                }}
                title="Cliquer pour éditer les tags"
              >
                {asset.tags.length > 0
                  ? asset.tags.map((t) => (
                      <span key={t} className="text-[9px] bg-info-50 text-info-700 border border-info-200 px-1 rounded">
                        {t}
                      </span>
                    ))
                  : (
                      <span className="text-[9px] text-muted-foreground/60 flex items-center gap-0.5">
                        <Tag size={8} /> ajouter tags
                      </span>
                    )}
              </div>
            )}
          </div>
          <audio controls src={asset.url} className="h-8 w-36 sm:w-48 shrink-0" preload="none" />
          <button
            onClick={() => void downloadAsset({ id: asset.id, filename: asset.filename })}
            className="p-1.5 text-muted-foreground/60 hover:text-info-700 rounded transition-colors opacity-0 group-hover:opacity-100"
            title="Télécharger"
          >
            <Download size={14} />
          </button>
          {canManageAssets && (
            <>
              <button
                onClick={() => void handleResetAssetUsage(asset)}
                className="p-1.5 text-muted-foreground/60 hover:text-warning-700 rounded transition-colors opacity-0 group-hover:opacity-100"
                title={accountFilter ? "Réinitialiser les stats de ce compte" : "Réinitialiser les compteurs"}
              >
                <RotateCcw size={14} />
              </button>
              <button
                onClick={() => void handleDelete(asset)}
                className="p-1.5 text-muted-foreground/60 hover:text-red-500 rounded transition-colors opacity-0 group-hover:opacity-100"
                title="Supprimer"
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
