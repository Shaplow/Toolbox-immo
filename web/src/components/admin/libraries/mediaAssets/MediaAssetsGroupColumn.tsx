"use client";

/**
 * MediaAssetsGroupColumn — colonne de groupe pour la vue grouped.
 *
 * Phase D9-step3 du split C1-v2 (plan F1). Extrait `renderColumn`
 * (~135 LOC inline) en composant réutilisable consommé par la vue
 * grouped (via MediaAssetsGroupedView en prop callback).
 *
 * Rend : header de colonne (catégorie inline edit + nom du pack/pool +
 * count + badge rotation + last used) + section "Rushes" (tags rôles
 * détectés automatiquement) + main assets via renderVideoCard callback.
 *
 * Le rendu de la card vidéo (388 LOC) est délégué via la prop
 * `renderVideoCard` pour partager la même logique entre les 3 vues
 * (grid, grouped, rotation).
 */

import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Clock,
  Film,
  FolderOpen,
  Layers,
  ListOrdered,
  Lock,
  MinusCircle,
  PlusCircle,
  RotateCcw,
} from "lucide-react";
import type { MediaAsset } from "./types";
import { formatDate } from "./helpers";

interface Props {
  // Identité du groupe
  groupKey: string;
  setTag: string | null;
  category: string | null;
  groupAssets: MediaAsset[];
  accessibleCount?: number;
  lastUsed: string | null;
  autoRank: number | null;
  isAccessible?: boolean;
  inSection?: boolean;
  fluid?: boolean;
  // Contexte rotation
  seqState: string[];
  accountFilter: string | null;
  // Inline edit category (group-level via handleSaveCategoryForGroup)
  editingFamilyKey: string | null;
  setEditingFamilyKey: (key: string | null) => void;
  familyInput: string;
  setFamilyInput: (v: string) => void;
  handleSaveCategoryForGroup: (groupAssets: MediaAsset[], value: string) => Promise<void>;
  // Sequence controls
  moveSetTag: (tag: string, direction: -1 | 1) => void;
  addToSequence: (tag: string) => void;
  removeFromSequence: (tag: string) => void;
  // Render callback for video cards (delegated to panel for shared logic)
  renderVideoCard: (asset: MediaAsset) => React.ReactNode;
}

export function MediaAssetsGroupColumn({
  groupKey,
  setTag,
  category,
  groupAssets,
  accessibleCount,
  lastUsed,
  autoRank,
  isAccessible = true,
  inSection = false,
  fluid = false,
  seqState,
  accountFilter,
  editingFamilyKey,
  setEditingFamilyKey,
  familyInput,
  setFamilyInput,
  handleSaveCategoryForGroup,
  moveSetTag,
  addToSequence,
  removeFromSequence,
  renderVideoCard,
}: Props) {
  const isAutoMode = seqState.length === 0;
  const seqIdx = setTag ? seqState.indexOf(setTag) : -1;
  const isSequenced = seqIdx !== -1;

  // Smart rush detection : un tag est "role" si présent sur SOME mais pas ALL des assets du pack.
  const tagFreq = new Map<string, MediaAsset[]>();
  for (const a of groupAssets) {
    for (const t of a.tags) {
      if (!tagFreq.has(t)) tagFreq.set(t, []);
      tagFreq.get(t)!.push(a);
    }
  }
  const roleTags = Array.from(tagFreq.entries())
    .filter(([, tagged]) => tagged.length < groupAssets.length)
    .sort(([a], [b]) => a.localeCompare(b));
  const roleAssetIds = new Set(roleTags.flatMap(([, tagged]) => tagged.map((a) => a.id)));
  const mainAssets = groupAssets.filter((a) => !roleAssetIds.has(a.id));
  const hasRoles = roleTags.length > 0;

  return (
    <div
      key={groupKey || "__unset__"}
      className={`flex flex-col ${fluid ? "w-full" : "w-52 shrink-0"} ${!isAccessible && accountFilter ? "opacity-50" : ""}`}
    >
      {/* Column header */}
      <div
        className={`mb-2 p-2.5 rounded-xl border flex flex-col gap-1 ${
          !isAccessible && accountFilter
            ? "bg-muted border-dashed border-border"
            : "bg-muted border-border"
        }`}
      >
        {!isAccessible && accountFilter && (
          groupAssets.every((a) => a.disabled)
            ? <span className="text-[9px] text-red-400 flex items-center gap-0.5 mb-0.5"><AlertTriangle size={8} /> Groupe désactivé — bloque la rotation</span>
            : <span className="text-[9px] text-muted-foreground flex items-center gap-0.5 mb-0.5"><Lock size={8} /> Hors accès pour ce compte</span>
        )}
        {/* Category */}
        {(setTag || category) && !inSection && (
          <div>
            {editingFamilyKey === groupKey ? (
              <input
                autoFocus
                value={familyInput}
                onChange={(e) => setFamilyInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void handleSaveCategoryForGroup(groupAssets, familyInput);
                    setEditingFamilyKey(null);
                  }
                  if (e.key === "Escape") setEditingFamilyKey(null);
                }}
                onBlur={() => {
                  void handleSaveCategoryForGroup(groupAssets, familyInput);
                  setEditingFamilyKey(null);
                }}
                list="group-list"
                placeholder="ex: Tenue A, Plan Ext…"
                className="w-full text-[10px] border border-danger-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-danger-200"
              />
            ) : (
              <button
                onClick={() => { setEditingFamilyKey(groupKey); setFamilyInput(category ?? ""); }}
                className={`flex items-center gap-1 text-[10px] w-full text-left px-1.5 py-0.5 rounded border transition-colors ${
                  category
                    ? "bg-danger-50 text-danger-700 border-danger-200 hover:bg-danger-100 font-medium"
                    : "text-muted-foreground border-dashed border-border hover:border-danger-200 hover:text-danger-600"
                }`}
                title="Catégorie du groupe — deux groupes de la même catégorie ne se suivent jamais dans la rotation"
              >
                <FolderOpen size={10} className="shrink-0" />
                <span className="truncate">{category || "Catégorie…"}</span>
              </button>
            )}
          </div>
        )}
        {/* Divider */}
        {(setTag || category) && !inSection && <div className="h-px bg-gray-200" />}
        {/* Pack name */}
        {setTag ? (
          <div className="flex items-center gap-1.5">
            <Layers size={11} className="text-danger-200 shrink-0" />
            <span className="text-xs font-semibold text-gray-800 truncate" title={setTag}>{setTag}</span>
          </div>
        ) : category ? (
          <span className="text-xs font-medium text-muted-foreground italic">Pool catégorie</span>
        ) : (
          <span className="text-xs font-medium text-muted-foreground">Sans pack</span>
        )}
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] text-muted-foreground">
            {accessibleCount ?? groupAssets.length} rush{(accessibleCount ?? groupAssets.length) !== 1 ? "es" : ""}
          </span>
          {(setTag || category) && (
            isAutoMode ? (
              autoRank === 1 ? (
                <span className="text-[10px] font-medium bg-success-50 text-success-700 border border-success-200 px-1.5 py-0.5 rounded flex items-center gap-1">
                  <RotateCcw size={9} /> Prochain
                </span>
              ) : (
                <span className="text-[10px] text-muted-foreground bg-muted border border-border px-1.5 py-0.5 rounded flex items-center gap-1">
                  <RotateCcw size={9} /> {autoRank != null ? `Dans ${autoRank - 1} gén.` : "–"}
                </span>
              )
            ) : (
              isSequenced ? (
                <div className="flex items-center gap-0.5">
                  <span className="text-[10px] font-mono bg-info-100 text-info-700 border border-info-200 px-1.5 py-0.5 rounded flex items-center gap-1">
                    <ListOrdered size={10} /> #{seqIdx + 1}
                  </span>
                  <button onClick={() => moveSetTag(setTag!, -1)} disabled={seqIdx === 0} className="p-0.5 rounded hover:bg-muted disabled:opacity-30">
                    <ChevronUp size={12} className="text-muted-foreground" />
                  </button>
                  <button onClick={() => moveSetTag(setTag!, 1)} disabled={seqIdx === seqState.length - 1} className="p-0.5 rounded hover:bg-muted disabled:opacity-30">
                    <ChevronDown size={12} className="text-muted-foreground" />
                  </button>
                  <button onClick={() => removeFromSequence(setTag!)} className="text-[10px] text-red-400 hover:text-red-600 px-0.5 flex items-center" title="Retirer de la rotation">
                    <MinusCircle size={11} />
                  </button>
                </div>
              ) : (
                <button onClick={() => addToSequence(setTag!)} className="flex items-center gap-1 text-[10px] text-info-700 hover:text-info-700 border border-info-200 rounded-full px-2 py-0.5">
                  <PlusCircle size={10} /> Fixer l&apos;ordre
                </button>
              )
            )
          )}
        </div>
        {(setTag || category) && lastUsed && (
          <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
            <Clock size={9} /> {formatDate(lastUsed)}
          </span>
        )}
      </div>

      {/* Rushes avec rôles définis */}
      {hasRoles && (
        <div className="border border-dashed border-warning-200 bg-warning-50/40 rounded-xl p-1.5 mb-2">
          <span className="text-[9px] font-semibold text-warning-700 uppercase tracking-wide mb-1.5 flex items-center gap-1">
            <Film size={9} /> Rushes
          </span>
          {roleTags.map(([tag, assets]) => (
            <div key={tag} className="mb-1.5 last:mb-0">
              <span className="text-[9px] text-warning-700 mb-1 block pl-0.5">{tag}</span>
              <div className="flex flex-col gap-1.5">{assets.map((a) => renderVideoCard(a))}</div>
            </div>
          ))}
        </div>
      )}

      {/* Main assets */}
      {mainAssets.length > 0 && (
        <div className="flex flex-col gap-2">
          {mainAssets.map((a) => renderVideoCard(a))}
        </div>
      )}
    </div>
  );
}
