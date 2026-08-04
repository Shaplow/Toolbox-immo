"use client";

/**
 * MediaAssetsCompactCard — card compacte single-row pour les vues
 * grouped et rotation du MediaAssetsPanel.
 *
 * Phase D9-step4 du split C1-v2 (plan F1). Extrait `renderCompactCard`
 * (~112 LOC inline) en composant standalone consommé par GroupedView
 * et RotationView (via prop callback).
 *
 * Différence avec MediaAssetsVideoCard : layout horizontal compact
 * (8×12 thumbnail + 1 ligne metadata + stats + delete), pas de preview
 * vidéo, métadonnées en lecture seule (read-only badges au lieu d'inline
 * edits). Reste éditable : catégorie et pack (les autres champs passent
 * par MediaAssetEditModal en cliquant sur le filename).
 *
 * Reçoit l'objet `inline` (UseAssetInlineEditsResult) pour les states +
 * handlers de category/setTag/delete.
 */

import {
  BarChart2,
  CheckSquare,
  Clock,
  Download,
  FolderOpen,
  Globe,
  Layers,
  Loader2,
  Lock,
  Square,
  Trash2,
} from "lucide-react";
import type { MediaAsset, MetadataField } from "./types";
import { LazyVideoThumb } from "./LazyVideoThumb";
import { downloadAsset } from "./downloadAssets";
import { useMediaLibraryPermissions } from "./mediaLibraryPermissions";
import type { UseAssetInlineEditsResult } from "./useAssetInlineEdits";

interface Props {
  asset: MediaAsset;
  accountFilter: string | null;
  metadataSchema: MetadataField[];
  selectMode: boolean;
  selectedIds: Set<string>;
  toggleSelect: (id: string) => void;
  hideCategory?: boolean;
  inline: UseAssetInlineEditsResult;
}

export function MediaAssetsCompactCard({
  asset,
  accountFilter,
  metadataSchema,
  selectMode,
  selectedIds,
  toggleSelect,
  hideCategory = false,
  inline,
}: Props) {
  const { canManageAssets } = useMediaLibraryPermissions();

  const {
    editingFamilyKey, setEditingFamilyKey: rawSetEditingFamilyKey, familyInput, setFamilyInput, handleSaveCategory,
    editingSetTagId, setEditingSetTagId: rawSetEditingSetTagId, setTagValue, setSetTagValue, setSetTagError, handleSaveSetTag,
    handleDelete,
  } = inline;

  // Lecture seule : l'entrée en édition inline est inerte (cf. MediaAssetsVideoCard).
  const noEdit = <T extends (...args: never[]) => void>(fn: T): T =>
    (canManageAssets ? fn : () => {}) as T;
  const setEditingFamilyKey = noEdit(rawSetEditingFamilyKey);
  const setEditingSetTagId = noEdit(rawSetEditingSetTagId);

  const isSelected = selectedIds.has(asset.id);
  const isAssetAccessible = !accountFilter ||
    asset.accessAccountIds.length === 0 ||
    asset.accessAccountIds.includes(accountFilter);

  return (
    <div
      key={asset.id}
      className={`group flex items-center gap-2 bg-white rounded-lg border px-2 py-1.5 transition-colors ${
        !isAssetAccessible ? "opacity-50" : ""
      } ${
        selectMode && isSelected ? "border-info-200 ring-1 ring-info-200" : "border-border hover:border-info-200"
      }`}
      onClick={() => { if (selectMode) toggleSelect(asset.id); }}
    >
      {/* Tiny thumbnail */}
      <a
        href={selectMode ? undefined : asset.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => { if (selectMode) e.preventDefault(); else e.stopPropagation(); }}
        className="relative w-8 h-12 rounded overflow-hidden shrink-0 bg-muted block"
      >
        <LazyVideoThumb url={asset.url} posterUrl={asset.posterUrl} className="w-full h-full object-cover" />
        {asset.pendingEditJob && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-10 pointer-events-none">
            <Loader2 size={10} className="text-white animate-spin" />
          </div>
        )}
        {selectMode && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            {isSelected ? <CheckSquare size={12} className="text-white" /> : <Square size={12} className="text-white/70" />}
          </div>
        )}
      </a>

      {/* Info */}
      <div className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1 mb-0.5 flex-wrap">
          {!hideCategory && (
            editingFamilyKey === asset.id ? (
              <input
                autoFocus
                value={familyInput}
                onChange={(e) => setFamilyInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { void handleSaveCategory(asset, familyInput); setEditingFamilyKey(null); }
                  if (e.key === "Escape") setEditingFamilyKey(null);
                }}
                onBlur={() => { void handleSaveCategory(asset, familyInput); setEditingFamilyKey(null); }}
                list="group-list"
                placeholder="Catégorie…"
                className="w-20 text-[9px] border border-input rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            ) : (
              <button
                onClick={() => { setEditingFamilyKey(asset.id); setFamilyInput(asset.category ?? ""); }}
                className={`flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded border ${
                  asset.category
                    ? "bg-muted text-foreground border-border hover:bg-zinc-200/70"
                    : "bg-card text-muted-foreground/60 border-dashed border-border hover:text-foreground"
                }`}
              >
                <FolderOpen size={7} /><span>{asset.category || "–"}</span>
              </button>
            )
          )}
          {!hideCategory && asset.setTag && !asset.setTag.startsWith("pack_") && editingSetTagId !== asset.id && (
            <span className="text-[9px] text-muted-foreground/60">›</span>
          )}
          {editingSetTagId === asset.id ? (
            <input
              autoFocus
              value={setTagValue}
              onChange={(e) => setSetTagValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); void handleSaveSetTag(asset, setTagValue); }
                if (e.key === "Escape") { setEditingSetTagId(null); setSetTagValue(""); setSetTagError(null); }
              }}
              onBlur={() => { void handleSaveSetTag(asset, setTagValue); }}
              list="set-tags-list"
              placeholder="Groupe…"
              className="w-16 text-[9px] border border-primary/40 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
          ) : asset.setTag && !asset.setTag.startsWith("pack_") ? (
            <button
              onClick={() => { setEditingSetTagId(asset.id); setSetTagValue(asset.setTag ?? ""); }}
              className="flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded border bg-primary/10 text-primary border-primary/20 hover:bg-primary/20"
              title="Groupe — plans joués ensemble"
            >
              <Layers size={7} /><span>{asset.setTag}</span>
            </button>
          ) : (
            <button
              onClick={() => { setEditingSetTagId(asset.id); setSetTagValue(""); }}
              className="flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded text-muted-foreground/40 hover:text-primary"
              title="Grouper avec d'autres plans"
            >
              <Layers size={7} /><span>Groupe</span>
            </button>
          )}
        </div>
        <a
          href={asset.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] font-medium text-foreground truncate hover:text-info-700 hover:underline block"
          title={asset.filename}
        >
          {asset.filename}
        </a>
        {asset.tags.length > 0 && (
          <div className="flex flex-wrap gap-0.5 mt-0.5">
            {asset.tags.map((t) => (
              <span key={t} className="text-[9px] bg-info-50 text-info-700 border border-info-100 px-1 rounded">{t}</span>
            ))}
          </div>
        )}
      </div>

      {/* Métadonnées en lecture seule (compact) */}
      {metadataSchema.length > 0 && Object.keys(asset.metadata ?? {}).length > 0 && (
        <div className="flex flex-col gap-0.5 shrink-0 text-[9px] text-muted-foreground max-w-[80px]" onClick={(e) => e.stopPropagation()}>
          {metadataSchema.map((field) => {
            const value = asset.metadata?.[field.key];
            if (value === null || value === undefined || value === "") return null;
            return (
              <span key={field.key} className="truncate" title={`${field.label} : ${String(value)}`}>
                <span className="text-muted-foreground/60">{field.label.slice(0, 6)}·</span>{String(value)}
              </span>
            );
          })}
        </div>
      )}

      {/* Stats + access indicator */}
      <div className="flex flex-col items-end gap-0.5 shrink-0 text-[9px] text-muted-foreground">
        <span className="flex items-center gap-0.5"><BarChart2 size={8} />{asset.usageCount}</span>
        <span className="flex items-center gap-0.5">
          <Clock size={8} />
          {asset.lastUsedAt ? new Date(asset.lastUsedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) : "Jamais"}
        </span>
        {asset.accessAccountIds.length === 0
          ? <span className="flex items-center gap-0.5 text-muted-foreground/60" title="Accessible à tous"><Globe size={7} /></span>
          : <span className="flex items-center gap-0.5 text-blue-400" title={`Accès restreint : ${asset.accessAccountIds.length} compte${asset.accessAccountIds.length > 1 ? "s" : ""}`}>
              <Lock size={7} />{asset.accessAccountIds.length}
            </span>
        }
      </div>

      {/* Download + delete */}
      {!selectMode && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            void downloadAsset({ id: asset.id, filename: asset.filename });
          }}
          className="opacity-0 group-hover:opacity-100 shrink-0 w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-info-700 transition"
          title="Télécharger"
        >
          <Download size={11} />
        </button>
      )}
      {!selectMode && canManageAssets && (
        <button
          onClick={(e) => { e.stopPropagation(); void handleDelete(asset); }}
          className="opacity-0 group-hover:opacity-100 shrink-0 w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-red-500 transition"
          title="Supprimer"
        >
          <Trash2 size={11} />
        </button>
      )}
    </div>
  );
}
