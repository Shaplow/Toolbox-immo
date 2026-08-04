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
 * - Breadcrumb catégorie › pack avec inline edit (handleSaveCategory + handleSaveSetTag).
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
  ChevronRight,
  Clock,
  Download,
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
  Video,
  X,
} from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { InstagramAccount, MediaAsset, MetadataField } from "./types";
import { formatDate, formatDuration } from "./helpers";
import { LazyVideoThumb } from "./LazyVideoThumb";
import type { UseAssetInlineEditsResult } from "./useAssetInlineEdits";
import { downloadAsset } from "./downloadAssets";
import { useMediaLibraryPermissions } from "./mediaLibraryPermissions";

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
  /** Phase 3 — mode avancé : si false, l'inline edit block est remplacé
      par un mini-footer (filename + chevron). Click → onOpenDetail. */
  isAdvanced: boolean;
  /** Mode manuel (rotation "none") : pas de chip Catégorie/Pack ni "à ranger",
      afficher metadata principales à la place. */
  isManualMode?: boolean;
  onOpenDetail?: (asset: MediaAsset) => void;
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
  isAdvanced,
  isManualMode = false,
  onOpenDetail,
}: Props) {
  const { canManageAssets } = useMediaLibraryPermissions();

  const {
    editingFamilyKey, setEditingFamilyKey: rawSetEditingFamilyKey, familyInput, setFamilyInput,
    editingSetTagId, setEditingSetTagId: rawSetEditingSetTagId, setTagValue, setSetTagValue, setTagError, setSetTagError,
    editingTagsId, setEditingTagsId: rawSetEditingTagsId, tagInput, setTagInput,
    editingUsageId, setEditingUsageId: rawSetEditingUsageId, usageInput, setUsageInput,
    editingLastUsedId, setEditingLastUsedId: rawSetEditingLastUsedId, lastUsedInput, setLastUsedInput,
    editingMetaKey, setEditingMetaKey: rawSetEditingMetaKey, metaInput, setMetaInput, savedMetaFlash, metaSaveError,
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

  // Lecture seule : on neutralise l'ENTRÉE en édition inline plutôt que de
  // conditionner les ~7 déclencheurs disséminés dans le rendu. Aucun champ ne
  // peut donc s'ouvrir, et un déclencheur ajouté plus tard reste couvert.
  const noEdit = <T extends (...args: never[]) => void>(fn: T): T =>
    (canManageAssets ? fn : () => {}) as T;
  const setEditingFamilyKey = noEdit(rawSetEditingFamilyKey);
  const setEditingSetTagId = noEdit(rawSetEditingSetTagId);
  const setEditingTagsId = noEdit(rawSetEditingTagsId);
  const setEditingUsageId = noEdit(rawSetEditingUsageId);
  const setEditingLastUsedId = noEdit(rawSetEditingLastUsedId);
  const setEditingMetaKey = noEdit(rawSetEditingMetaKey);

  const isSelected = selectedIds.has(asset.id);
  const isAssetAccessible = !accountFilter ||
    asset.accessAccountIds.length === 0 ||
    asset.accessAccountIds.includes(accountFilter);

  return (
    <div
      key={asset.id}
      className={[
        "group relative rounded-2xl overflow-hidden transition-all",
        "bg-card border border-border ",
        !isAssetAccessible ? "opacity-50" : "",
        isSelected
          ? ""
          : " hover: hover:-translate-y-0.5",
        !isAdvanced && !selectMode ? "cursor-pointer" : "",
      ].filter(Boolean).join(" ")}
      onClick={() => {
        if (selectMode) { toggleSelect(asset.id); return; }
        if (!isAdvanced) onOpenDetail?.(asset);
      }}
    >
      {/* Phase C — mini-checkbox bulk-select visible au hover, sans entrer en select mode. */}
      {!selectMode && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggleSelect(asset.id);
          }}
          className="absolute top-2 left-2 z-30 h-5 w-5 rounded-md bg-card border border-border  flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-white transition-opacity"
          title="Sélectionner"
          aria-label="Sélectionner cet asset"
        >
          <Square size={11} className="text-muted-foreground" />
        </button>
      )}
      {/* Thumbnail / preview */}
      <div className="relative aspect-[9/16] bg-gray-200">
        {previewId === asset.id ? (
          <video src={asset.url} controls autoPlay className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <>
            <LazyVideoThumb url={asset.url} posterUrl={asset.posterUrl} className="w-full h-full object-cover" />
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
          <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-gray-950/65 text-[10px] font-mono text-white tabular-nums">
            {formatDuration(asset.duration)}
          </span>
        )}
        {/* Badge "Restreint @compte" en bottom-left (mode noob) — visible si accessAccountIds non-vide */}
        {!isAdvanced && asset.accessAccountIds.length > 0 && (() => {
          const handles = asset.accessAccountIds
            .map((id) => accounts.find((a) => a.id === id)?.handle)
            .filter(Boolean) as string[];
          const label = handles.length === 1 ? `@${handles[0]}` : `${handles.length} comptes`;
          const title = handles.length > 0 ? `Restreint à : ${handles.map((h) => `@${h}`).join(", ")}` : "Restreint";
          return (
            <span
              title={title}
              className="absolute bottom-2 left-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-info-50/90 text-info-700 text-[9.5px] font-medium  max-w-[60%] truncate"
            >
              <Lock size={9} className="shrink-0" />
              <span className="truncate">{label}</span>
            </span>
          );
        })()}
        {/* Chips Catégorie + Pack en overlay top-right (mode noob, rotation auto/override).
            Badge "à ranger" retiré — l'absence de chip catégorie est elle-même le signal.
            En mode manuel (rotation "none") : pas de chip, on affiche metadata dans le footer à la place. */}
        {!isAdvanced && !isManualMode && (asset.category || (asset.setTag && !asset.setTag.startsWith("pack_"))) && (
          <div className="absolute top-2 right-2 flex flex-col items-end gap-1 max-w-[70%] z-10">
            {asset.category && (
              <span className="text-[9.5px] font-medium px-1.5 py-0.5 rounded-md bg-card border border-border text-foreground inline-flex items-center gap-0.5 truncate max-w-full">
                <FolderOpen size={8} className="shrink-0" />
                <span className="truncate">{asset.category}</span>
              </span>
            )}
            {asset.setTag && !asset.setTag.startsWith("pack_") && (
              <span className="text-[9.5px] font-medium px-1.5 py-0.5 rounded-md bg-primary/10 border border-primary/20 text-primary inline-flex items-center gap-0.5 truncate max-w-full">
                <Layers size={8} className="shrink-0" />
                <span className="truncate">{asset.setTag}</span>
              </span>
            )}
          </div>
        )}
        {asset.pendingEditJob && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/60 gap-1.5 pointer-events-none">
            <Loader2 size={20} className="text-white animate-spin" />
            <span className="text-[10px] text-white font-medium text-center px-2 leading-tight">Remplacement<br />en cours…</span>
          </div>
        )}
        {asset.disabled && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-warning-700/50 gap-1 pointer-events-none">
            <EyeOff size={18} className="text-warning-200" />
            <span className="text-[10px] text-warning-100 font-medium">Désactivé</span>
          </div>
        )}
        {selectMode && (
          <div className="absolute top-1 right-1 z-10" onClick={(e) => { e.stopPropagation(); toggleSelect(asset.id); }}>
            {isSelected
              ? <CheckSquare size={16} className="text-info-700 drop-shadow" />
              : <Square size={16} className="text-white/80 drop-shadow" />}
          </div>
        )}
      </div>
      {/* Info — mode avancé : inline edits complets. Mode noob : footer minimaliste.
          En manual mode (rotation "none") : on met en avant les 2 premières metadata
          déclarées dans metadataSchema (au lieu du filename qui devient secondaire). */}
      {!isAdvanced ? (
        isManualMode && metadataSchema.length > 0 ? (
          <div className="px-2.5 py-2 flex items-start gap-1.5">
            <div className="flex-1 min-w-0">
              {(() => {
                const primary = metadataSchema[0];
                const secondary = metadataSchema[1];
                const primaryValue = primary ? asset.metadata?.[primary.key] : null;
                const secondaryValue = secondary ? asset.metadata?.[secondary.key] : null;
                return (
                  <>
                    <p className="text-[12px] font-semibold text-foreground truncate leading-tight" title={primary?.label}>
                      {primaryValue != null && primaryValue !== "" ? String(primaryValue) : <span className="text-muted-foreground italic font-normal">{primary?.label ?? asset.filename}</span>}
                    </p>
                    {secondary && (
                      <p className="text-[10.5px] text-muted-foreground truncate mt-0.5" title={secondary.label}>
                        {secondaryValue != null && secondaryValue !== "" ? String(secondaryValue) : <span className="italic">{secondary.label}</span>}
                      </p>
                    )}
                  </>
                );
              })()}
            </div>
            <ChevronRight size={13} className="text-muted-foreground/60 group-hover:text-foreground shrink-0 mt-0.5 transition-colors" />
          </div>
        ) : (
          <div className="px-2.5 py-2 flex items-center gap-1.5">
            <Video size={11} className="shrink-0 text-muted-foreground" />
            <p className="flex-1 min-w-0 text-[11.5px] font-medium text-foreground truncate" title={asset.filename}>
              {asset.filename}
            </p>
            <ChevronRight size={13} className="text-muted-foreground/60 group-hover:text-foreground shrink-0 transition-colors" />
          </div>
        )
      ) : (
      <div className="p-2.5">
        {/* Catégorie + Pack */}
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
              className="w-24 text-[9px] border border-input rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
          ) : (
            <button
              onClick={() => { setEditingFamilyKey(asset.id); setFamilyInput(asset.category ?? ""); }}
              className={`flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded border transition-colors ${
                asset.category
                  ? "bg-muted text-foreground border-border hover:bg-zinc-200/70"
                  : "bg-card text-muted-foreground border-dashed border-border hover:text-foreground hover:border-zinc-300"
              }`}
              title="Catégorie (thème rotation) — cliquer pour modifier"
            >
              <FolderOpen size={8} className="shrink-0" />
              <span>{asset.category || "Catégorie…"}</span>
            </button>
          )}
          {/* Séparateur visible seulement si un Groupe réel est affiché. */}
          {asset.setTag && !asset.setTag.startsWith("pack_") && editingSetTagId !== asset.id && (
            <span className="text-[9px] text-muted-foreground/60">›</span>
          )}
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
                placeholder="Groupe…"
                className="w-20 text-[9px] border border-primary/40 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
              {setTagValue.trim() && setTagValue.trim() !== asset.setTag && (() => {
                const existingCategories = Array.from(new Set(
                  assets.filter((a) => a.setTag === setTagValue.trim() && a.id !== asset.id && a.category).map((a) => a.category!)
                ));
                return existingCategories.length > 0 ? (
                  <span className="text-[9px] flex items-center gap-0.5 font-medium text-warning-700">
                    <FolderOpen size={8} /> Catégorie existante&nbsp;: {existingCategories[0]}
                  </span>
                ) : null;
              })()}
              {setTagError && <span className="text-[9px] text-red-500">{setTagError}</span>}
            </div>
          ) : asset.setTag && !asset.setTag.startsWith("pack_") ? (
            // Groupe réel → chip accent indigo (distinct de la catégorie neutre).
            <button
              onClick={() => { setEditingSetTagId(asset.id); setSetTagValue(asset.setTag ?? ""); }}
              className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded border bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 transition-colors"
              title="Groupe — plans joués ensemble dans un même rendu"
            >
              <Layers size={8} className="shrink-0" />
              <span>{asset.setTag}</span>
            </button>
          ) : (
            // Pas de Groupe réel (vide ou pack_ auto) → affordance discrète.
            <button
              onClick={() => { setEditingSetTagId(asset.id); setSetTagValue(""); }}
              className="flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded text-muted-foreground/50 hover:text-primary transition-colors"
              title="Grouper avec d'autres plans (joués ensemble)"
            >
              <Layers size={8} className="shrink-0" />
              <span>Groupe</span>
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
              className="w-full text-xs border border-info-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-info-200"
            />
          </div>
        ) : (
          <div
            className="flex flex-wrap gap-1 min-h-[26px] cursor-pointer -mx-1 px-1 py-1 rounded-lg hover:bg-muted transition-colors mb-1"
            onClick={(e) => { e.stopPropagation(); setEditingTagsId(asset.id); setTagInput(asset.tags.join(", ")); }}
            title="Tags : cliquer pour éditer (intro, outro, rôle…)"
          >
            {asset.tags.length > 0 ? asset.tags.map((t) => (
              <span key={t} className="text-[10px] bg-info-50 text-info-700 border border-info-200 px-1.5 py-0.5 rounded">{t}</span>
            )) : (
              <span className="text-[10px] text-muted-foreground/60 flex items-center gap-0.5"><Tag size={9} /> ajouter tags…</span>
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
                  <span className="text-[9px] text-muted-foreground shrink-0 truncate" style={isTextarea ? undefined : { width: 68 }} title={field.label}>{field.label}</span>
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
                        className="w-full min-w-0 text-[10px] border border-info-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-info-200 bg-white resize-y"
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
                        className="flex-1 min-w-0 text-[10px] border border-info-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-info-200 bg-white"
                      />
                    )
                  ) : (
                    <button
                      onClick={() => { setEditingMetaKey({ assetId: asset.id, key: field.key }); setMetaInput(displayValue); }}
                      className={`${isTextarea ? "w-full text-left" : "flex-1 min-w-0 truncate text-left"} text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                        hasError
                          ? "bg-red-50 text-red-600 border-red-300"
                          : justSaved && displayValue
                          ? "bg-success-100 text-success-700 border-success-200"
                          : displayValue
                          ? "bg-success-50 text-success-700 border-success-200 hover:bg-success-100"
                          : "bg-muted text-muted-foreground/60 border-dashed border-border hover:text-success-600 hover:border-success-200"
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
            <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground/60" title="Accessible à tous les comptes">
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
              className="text-[9px] text-muted-foreground border border-dashed border-border rounded px-1 py-0.5 focus:outline-none hover:border-blue-300 hover:text-blue-500 max-w-[80px] cursor-pointer"
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
              className="w-14 text-[10px] border border-info-200 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-info-200"
              onClick={(e) => e.stopPropagation()}
            />
          ) : accountFilter ? (
            <span
              className="flex items-center gap-0.5 text-[10px] text-muted-foreground"
              title="Stats du compte (lecture seule — basculer en vue globale pour modifier)"
            >
              <BarChart2 size={10} /> {asset.usageCount} <span className="text-muted-foreground/60">(compte)</span>
            </span>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); setEditingUsageId(asset.id); setUsageInput(String(asset.usageCount)); }}
              className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-info-700 hover:underline transition-colors"
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
              className="w-full text-[10px] border border-warning-200 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-orange-400"
              onClick={(e) => e.stopPropagation()}
            />
          ) : accountFilter ? (
            <span
              className="flex items-center gap-0.5 text-[10px] text-muted-foreground"
              title="Dernière utilisation du compte (lecture seule)"
            >
              <Clock size={10} /> {formatDate(asset.lastUsedAt)}
            </span>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); setEditingLastUsedId(asset.id); setLastUsedInput(toDateInputValue(asset.lastUsedAt)); }}
              className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-warning-700 hover:underline transition-colors"
              title="Dernière utilisation : cliquer pour modifier"
            >
              <Clock size={10} /> {formatDate(asset.lastUsedAt)}
            </button>
          )}
        </div>
      </div>
      )}

      {/* Action buttons */}
      {!selectMode && canManageAssets && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); void handleDelete(asset); }}
            className="absolute top-1.5 left-1.5 w-6 h-6 bg-white/80 hover:bg-red-50 text-muted-foreground hover:text-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow"
            title="Supprimer"
          >
            <Trash2 size={11} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onEditAsset(asset); }}
            className="absolute top-8 left-1.5 w-6 h-6 bg-white/80 hover:bg-danger-50 text-muted-foreground hover:text-danger-700 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow"
            title="Éditer (trim, audio)"
          >
            <Scissors size={11} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); void handleToggleDisabled(asset); }}
            className={`absolute top-14.5 left-1.5 w-6 h-6 bg-white/80 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow ${
              asset.disabled
                ? "text-warning-700 hover:text-warning-700 hover:bg-warning-50"
                : "text-muted-foreground hover:text-warning-700 hover:bg-warning-50"
            }`}
            title={asset.disabled ? "Réactiver dans la rotation" : "Désactiver de la rotation (garder dans la bibliothèque)"}
          >
            <EyeOff size={11} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); void handleResetAssetUsage(asset); }}
            className="absolute top-1.5 right-1.5 w-6 h-6 bg-white/80 hover:bg-warning-50 text-muted-foreground hover:text-warning-700 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow"
            title={accountFilter ? "Réinitialiser les stats de ce compte" : "Réinitialiser les compteurs"}
          >
            <RotateCcw size={11} />
          </button>
        </>
      )}

      {/* Télécharger — hors du bloc de gestion : c'est la seule action offerte
          à un rôle en lecture seule. Sans les boutons de gestion, la pile de
          droite est libre, d'où la remontée en haut. */}
      {!selectMode && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            void downloadAsset({ id: asset.id, filename: asset.filename });
          }}
          className={`absolute ${canManageAssets ? "top-8" : "top-1.5"} right-1.5 w-6 h-6 bg-white/80 hover:bg-info-50 text-muted-foreground hover:text-info-700 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow`}
          title="Télécharger"
        >
          <Download size={11} />
        </button>
      )}
    </div>
  );
}
