"use client";

/**
 * MediaAssetsVideoCard — card vidéo standalone du MediaAssetsPanel.
 *
 * Phase D9-step2 du split C1-v2 (plan F1). Extrait `renderVideoCard`
 * (~388 LOC inline) en composant réutilisable consommé par la vue grid.
 *
 * Le composant orchestre :
 * - Thumbnail (LazyVideoThumb) + preview vidéo HTML5 sur click Play.
 * - Overlay select mode (CheckSquare / Square).
 * - Overlay pendingEditJob (replacement in progress) + disabled (EyeOff).
 * - Breadcrumb catégorie › set avec inline edit (handleSaveCategory + handleSaveSetTag).
 * - Tags inline edit (handleSaveTags).
 * - Métadonnées du bien (schemaField.type = text/number/url/textarea).
 * - Accès accounts (ajouter/retirer via handleToggleAccess).
 * - Stats row : usage + lastUsed inline edit (handleSaveUsage / handleSaveLastUsed).
 * - Action buttons : delete, edit (Scissors → MediaAssetEditModal),
 *   toggle disabled (handleToggleDisabled), reset usage.
 *
 * Le hook useAssetInlineEdits (D9-step1) fournit l'ensemble des states et
 * handlers en bloc — passé via la prop `inline`. Cela évite de propager
 * 30+ props individuelles à chaque card.
 */

import {
  BarChart2,
  CheckSquare,
  Clock,
  EyeOff,
  FolderOpen,
  Globe,
  Layers,
  Loader2,
  Lock,
  Play,
  RotateCcw,
  Scissors,
  Square,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { InstagramAccount, MediaAsset, MetadataField } from "./types";
import { formatDate, formatDuration } from "./helpers";
import { LazyVideoThumb } from "./LazyVideoThumb";
import type { UseAssetInlineEditsResult } from "./useAssetInlineEdits";

interface Props {
  asset: MediaAsset;
  assets: MediaAsset[];
  accounts: InstagramAccount[];
  accountFilter: string | null;
  metadataSchema: MetadataField[];
  selectMode: boolean;
  selectedIds: Set<string>;
  toggleSelect: (id: string) => void;
  previewId: string | null;
  setPreviewId: Dispatch<SetStateAction<string | null>>;
  onEditAsset: (asset: MediaAsset) => void;
  inline: UseAssetInlineEditsResult;
}

export function MediaAssetsVideoCard({
  asset,
  assets,
  accounts,
  accountFilter,
  metadataSchema,
  selectMode,
  selectedIds,
  toggleSelect,
  previewId,
  setPreviewId,
  onEditAsset,
  inline,
}: Props) {
  const {
    editingFamilyKey, setEditingFamilyKey, familyInput, setFamilyInput,
    editingSetTagId, setEditingSetTagId, setTagValue, setSetTagValue, setTagError, setSetTagError,
    editingTagsId, setEditingTagsId, tagInput, setTagInput,
    editingUsageId, setEditingUsageId, usageInput, setUsageInput,
    editingLastUsedId, setEditingLastUsedId, lastUsedInput, setLastUsedInput,
    editingMetaKey, setEditingMetaKey, metaInput, setMetaInput, savedMetaFlash, metaSaveError,
    handleSaveCategory,
    handleSaveSetTag,
    handleSaveTags,
    handleSaveUsage,
    handleSaveLastUsed,
    handleSaveMetadata,
    handleToggleAccess,
    handleToggleDisabled,
    handleResetAssetUsage,
    handleDelete,
    toDateInputValue,
  } = inline;

  const isSelected = selectedIds.has(asset.id);
  const isAssetAccessible = !accountFilter ||
    asset.accessAccountIds.length === 0 ||
    asset.accessAccountIds.includes(accountFilter);

  return (
    <div
      key={asset.id}
      className={`group relative bg-gray-100 rounded-xl overflow-hidden border transition-colors ${
        !isAssetAccessible ? "opacity-50" : ""
      } ${
        selectMode && isSelected
          ? "border-indigo-500 ring-2 ring-indigo-200"
          : "border-gray-200 hover:border-indigo-300"
      }`}
      onClick={() => { if (selectMode) toggleSelect(asset.id); }}
    >
      {/* Thumbnail / preview */}
      <div className="relative aspect-[9/16] bg-gray-200">
        {previewId === asset.id ? (
          <video src={asset.url} controls autoPlay className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <>
            <LazyVideoThumb url={asset.url} className="w-full h-full object-cover" />
            {!selectMode && (
              <button
                onClick={() => setPreviewId(asset.id)}
                className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <div className="w-8 h-8 bg-white/90 rounded-full flex items-center justify-center shadow">
                  <Play size={14} className="text-gray-800 ml-0.5" />
                </div>
              </button>
            )}
          </>
        )}
        {previewId === asset.id && (
          <button
            onClick={() => setPreviewId(null)}
            className="absolute top-1 right-1 w-6 h-6 bg-black/60 text-white text-xs rounded-full flex items-center justify-center z-10"
          >✕</button>
        )}
        {asset.duration && (
          <span className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] px-1 rounded">
            {formatDuration(asset.duration)}
          </span>
        )}
        {asset.pendingEditJob && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/60 gap-1.5 pointer-events-none">
            <Loader2 size={20} className="text-white animate-spin" />
            <span className="text-[10px] text-white font-medium text-center px-2 leading-tight">Remplacement<br />en cours…</span>
          </div>
        )}
        {asset.disabled && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-amber-900/50 gap-1 pointer-events-none">
            <EyeOff size={18} className="text-amber-200" />
            <span className="text-[10px] text-amber-100 font-medium">Désactivé</span>
          </div>
        )}
        {selectMode && (
          <div className="absolute top-1 right-1 z-10" onClick={(e) => { e.stopPropagation(); toggleSelect(asset.id); }}>
            {isSelected
              ? <CheckSquare size={16} className="text-indigo-600 drop-shadow" />
              : <Square size={16} className="text-white/80 drop-shadow" />}
          </div>
        )}
      </div>
      {/* Info */}
      <div className="p-2.5">
        {/* Catégorie + Set */}
        <div className="flex items-center gap-1 mb-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
          {editingFamilyKey === asset.id ? (
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
              className="w-24 text-[9px] border border-violet-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-violet-400"
            />
          ) : (
            <button
              onClick={() => { setEditingFamilyKey(asset.id); setFamilyInput(asset.category ?? ""); }}
              className={`flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded border transition-colors ${
                asset.category
                  ? "bg-violet-50 text-violet-600 border-violet-100 hover:bg-violet-100"
                  : "bg-gray-50 text-gray-400 border-dashed border-gray-200 hover:text-violet-500 hover:border-violet-200"
              }`}
              title="Catégorie — cliquer pour modifier"
            >
              <FolderOpen size={8} className="shrink-0" />
              <span>{asset.category || "Catégorie…"}</span>
            </button>
          )}
          <span className="text-[9px] text-gray-300">›</span>
          {editingSetTagId === asset.id ? (
            <div className="flex flex-col gap-0.5">
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
                placeholder="set…"
                className="w-20 text-[9px] border border-pink-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-pink-400"
              />
              {setTagValue.trim() && setTagValue.trim() !== asset.setTag && (() => {
                const existingCategories = Array.from(new Set(
                  assets.filter((a) => a.setTag === setTagValue.trim() && a.id !== asset.id && a.category).map((a) => a.category!)
                ));
                return existingCategories.length > 0 ? (
                  <span className="text-[9px] flex items-center gap-0.5 font-medium text-orange-600">
                    <FolderOpen size={8} /> Catégorie existante&nbsp;: {existingCategories[0]}
                  </span>
                ) : null;
              })()}
              {setTagError && <span className="text-[9px] text-red-500">{setTagError}</span>}
            </div>
          ) : (
            <button
              onClick={() => { setEditingSetTagId(asset.id); setSetTagValue(asset.setTag ?? ""); }}
              className={`flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded border transition-colors ${
                asset.setTag
                  ? "bg-pink-50 text-pink-600 border-pink-100 hover:bg-pink-100"
                  : "bg-gray-50 text-gray-400 border-dashed border-gray-200 hover:text-pink-500 hover:border-pink-200"
              }`}
              title="Set — cliquer pour assigner"
            >
              <Layers size={8} className="shrink-0" />
              <span>{asset.setTag || "Set…"}</span>
            </button>
          )}
        </div>
        <p className="text-xs font-medium text-gray-800 truncate mb-2" title={asset.filename}>{asset.filename}</p>

        {/* Tags */}
        {editingTagsId === asset.id ? (
          <div className="mb-2" onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { void handleSaveTags(asset, tagInput.split(",").map((t) => t.trim()).filter(Boolean)); }
                if (e.key === "Escape") { setEditingTagsId(null); setTagInput(""); }
              }}
              onBlur={() => { void handleSaveTags(asset, tagInput.split(",").map((t) => t.trim()).filter(Boolean)); }}
              placeholder="intro, outro, plan1…"
              className="w-full text-xs border border-indigo-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </div>
        ) : (
          <div
            className="flex flex-wrap gap-1 min-h-[26px] cursor-pointer -mx-1 px-1 py-1 rounded-lg hover:bg-gray-50 transition-colors mb-1"
            onClick={(e) => { e.stopPropagation(); setEditingTagsId(asset.id); setTagInput(asset.tags.join(", ")); }}
            title="Tags : cliquer pour éditer (intro, outro, rôle…)"
          >
            {asset.tags.length > 0 ? asset.tags.map((t) => (
              <span key={t} className="text-[10px] bg-indigo-50 text-indigo-600 border border-indigo-200 px-1.5 py-0.5 rounded">{t}</span>
            )) : (
              <span className="text-[10px] text-gray-300 flex items-center gap-0.5"><Tag size={9} /> ajouter tags…</span>
            )}
          </div>
        )}

        {/* Métadonnées */}
        {metadataSchema.length > 0 && (
          <div className="mt-1.5 mb-1 space-y-1" onClick={(e) => e.stopPropagation()}>
            {metadataSchema.map((field) => {
              const isEditing = editingMetaKey?.assetId === asset.id && editingMetaKey.key === field.key;
              const value = asset.metadata?.[field.key];
              const displayValue = value !== null && value !== undefined ? String(value) : "";
              const isTextarea = field.type === "textarea";
              const justSaved = savedMetaFlash?.assetId === asset.id && savedMetaFlash.key === field.key;
              const hasError = metaSaveError?.assetId === asset.id && metaSaveError.key === field.key;
              return (
                <div key={field.key} className={isTextarea ? "flex flex-col gap-0.5" : "flex items-center gap-1.5"}>
                  <span className="text-[9px] text-gray-400 shrink-0 truncate" style={isTextarea ? undefined : { width: 68 }} title={field.label}>{field.label}</span>
                  {isEditing ? (
                    isTextarea ? (
                      <textarea
                        autoFocus
                        rows={4}
                        value={metaInput}
                        onChange={(e) => setMetaInput(e.target.value)}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Escape") void handleSaveMetadata(asset, field.key, metaInput);
                        }}
                        onBlur={() => void handleSaveMetadata(asset, field.key, metaInput)}
                        className="w-full min-w-0 text-[10px] border border-indigo-300 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white resize-y"
                      />
                    ) : (
                      <input
                        autoFocus
                        type={field.type === "number" ? "number" : "text"}
                        value={metaInput}
                        onChange={(e) => setMetaInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void handleSaveMetadata(asset, field.key, metaInput);
                          if (e.key === "Escape") setEditingMetaKey(null);
                        }}
                        onBlur={() => void handleSaveMetadata(asset, field.key, metaInput)}
                        className="flex-1 min-w-0 text-[10px] border border-indigo-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white"
                      />
                    )
                  ) : (
                    <button
                      onClick={() => { setEditingMetaKey({ assetId: asset.id, key: field.key }); setMetaInput(displayValue); }}
                      className={`${isTextarea ? "w-full text-left" : "flex-1 min-w-0 truncate text-left"} text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                        hasError
                          ? "bg-red-50 text-red-600 border-red-300"
                          : justSaved && displayValue
                          ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                          : displayValue
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                          : "bg-gray-50 text-gray-300 border-dashed border-gray-200 hover:text-emerald-500 hover:border-emerald-200"
                      }`}
                      title={displayValue || `Saisir ${field.label}`}
                    >
                      {isTextarea && displayValue
                        ? <span className="whitespace-pre-wrap break-words line-clamp-3">{displayValue}</span>
                        : (displayValue || "—")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Accès */}
        <div className="flex items-center gap-1 flex-wrap mt-1 mb-1" onClick={(e) => e.stopPropagation()}>
          {asset.accessAccountIds.length === 0 ? (
            <span className="flex items-center gap-0.5 text-[9px] text-gray-300" title="Accessible à tous les comptes">
              <Globe size={8} /> Global
            </span>
          ) : (
            asset.accessAccountIds.map((id) => {
              const acc = accounts.find((a) => a.id === id);
              return acc ? (
                <button
                  key={id}
                  onClick={() => void handleToggleAccess(asset, id, false)}
                  className="flex items-center gap-0.5 text-[9px] bg-blue-50 text-blue-600 border border-blue-100 px-1 py-0.5 rounded hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors"
                  title={`Retirer l'accès à @${acc.handle}`}
                >
                  <Lock size={7} />@{acc.handle}<X size={6} />
                </button>
              ) : null;
            })
          )}
          {accounts.filter((a) => !asset.accessAccountIds.includes(a.id)).length > 0 && (
            <select
              value=""
              onChange={(e) => { if (e.target.value) void handleToggleAccess(asset, e.target.value, true); }}
              className="text-[9px] text-gray-400 border border-dashed border-gray-200 rounded px-1 py-0.5 focus:outline-none hover:border-blue-300 hover:text-blue-500 max-w-[80px] cursor-pointer"
              title="Restreindre l'accès à un compte"
            >
              <option value="">+ compte</option>
              {accounts.filter((a) => !asset.accessAccountIds.includes(a.id)).map((a) => (
                <option key={a.id} value={a.id}>@{a.handle}</option>
              ))}
            </select>
          )}
        </div>

        {/* Stats row */}
        <div className="flex items-center justify-between gap-1">
          {!accountFilter && editingUsageId === asset.id ? (
            <input
              autoFocus
              type="number"
              min={0}
              value={usageInput}
              onChange={(e) => setUsageInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { void handleSaveUsage(asset, usageInput); }
                if (e.key === "Escape") { setEditingUsageId(null); setUsageInput(""); }
              }}
              onBlur={() => { void handleSaveUsage(asset, usageInput); }}
              className="w-14 text-[10px] border border-indigo-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              onClick={(e) => e.stopPropagation()}
            />
          ) : accountFilter ? (
            <span
              className="flex items-center gap-0.5 text-[10px] text-gray-400"
              title="Stats du compte (lecture seule — basculer en vue globale pour modifier)"
            >
              <BarChart2 size={10} /> {asset.usageCount} <span className="text-gray-300">(compte)</span>
            </span>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); setEditingUsageId(asset.id); setUsageInput(String(asset.usageCount)); }}
              className="flex items-center gap-0.5 text-[10px] text-gray-400 hover:text-indigo-600 hover:underline transition-colors"
              title="Cliquer pour modifier"
            >
              <BarChart2 size={10} /> {asset.usageCount}
            </button>
          )}
          {!accountFilter && editingLastUsedId === asset.id ? (
            <input
              autoFocus
              type="date"
              value={lastUsedInput}
              onChange={(e) => setLastUsedInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { void handleSaveLastUsed(asset, lastUsedInput); }
                if (e.key === "Escape") { setEditingLastUsedId(null); setLastUsedInput(""); }
              }}
              onBlur={() => { void handleSaveLastUsed(asset, lastUsedInput); }}
              className="w-full text-[10px] border border-orange-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-orange-400"
              onClick={(e) => e.stopPropagation()}
            />
          ) : accountFilter ? (
            <span
              className="flex items-center gap-0.5 text-[10px] text-gray-400"
              title="Dernière utilisation du compte (lecture seule)"
            >
              <Clock size={10} /> {formatDate(asset.lastUsedAt)}
            </span>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); setEditingLastUsedId(asset.id); setLastUsedInput(toDateInputValue(asset.lastUsedAt)); }}
              className="flex items-center gap-0.5 text-[10px] text-gray-400 hover:text-orange-600 hover:underline transition-colors"
              title="Dernière utilisation : cliquer pour modifier"
            >
              <Clock size={10} /> {formatDate(asset.lastUsedAt)}
            </button>
          )}
        </div>
      </div>

      {/* Action buttons */}
      {!selectMode && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); void handleDelete(asset); }}
            className="absolute top-1.5 left-1.5 w-6 h-6 bg-white/80 hover:bg-red-50 text-gray-500 hover:text-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow"
            title="Supprimer"
          >
            <Trash2 size={11} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onEditAsset(asset); }}
            className="absolute top-8 left-1.5 w-6 h-6 bg-white/80 hover:bg-violet-50 text-gray-500 hover:text-violet-600 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow"
            title="Éditer (trim, audio)"
          >
            <Scissors size={11} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); void handleToggleDisabled(asset); }}
            className={`absolute top-14.5 left-1.5 w-6 h-6 bg-white/80 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow ${
              asset.disabled
                ? "text-amber-500 hover:text-amber-700 hover:bg-amber-50"
                : "text-gray-500 hover:text-amber-500 hover:bg-amber-50"
            }`}
            title={asset.disabled ? "Réactiver dans la rotation" : "Désactiver de la rotation (garder dans la bibliothèque)"}
          >
            <EyeOff size={11} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); void handleResetAssetUsage(asset); }}
            className="absolute top-1.5 right-1.5 w-6 h-6 bg-white/80 hover:bg-orange-50 text-gray-500 hover:text-orange-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow"
            title={accountFilter ? "Réinitialiser les stats de ce compte" : "Réinitialiser les compteurs"}
          >
            <RotateCcw size={11} />
          </button>
        </>
      )}
    </div>
  );
}
