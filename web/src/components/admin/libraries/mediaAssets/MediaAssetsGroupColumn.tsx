"use client";

/**
 * MediaAssetsGroupColumn — colonne de dossier pour la vue grouped (mode avancé).
 *
 * Plan simplification 2026-08 : le dossier est identifié uniquement par
 * `setTag` (plus de catégorie, plus d'ordre de rotation personnalisé — le
 * tirage est géré côté serveur en LRU par dossier, sans état visible ici).
 *
 * Rend : header de colonne (nom du dossier + count + last used) + section
 * "Rushes" (tags rôles détectés automatiquement) + main assets via
 * renderVideoCard callback.
 *
 * Le rendu de la card vidéo (388 LOC) est délégué via la prop
 * `renderVideoCard` pour partager la même logique entre les 2 vues
 * (grid, grouped).
 */

import { AlertTriangle, Clock, Film, Layers, Lock } from "lucide-react";
import type { MediaAsset } from "./types";
import { formatDate } from "./helpers";

interface Props {
  // Identité du dossier
  groupKey: string;
  setTag: string | null;
  groupAssets: MediaAsset[];
  accessibleCount?: number;
  lastUsed: string | null;
  isAccessible?: boolean;
  fluid?: boolean;
  // Contexte
  accountFilter: string | null;
  // Render callback for video cards (delegated to panel for shared logic)
  renderVideoCard: (asset: MediaAsset) => React.ReactNode;
}

export function MediaAssetsGroupColumn({
  groupKey,
  setTag,
  groupAssets,
  accessibleCount,
  lastUsed,
  isAccessible = true,
  fluid = false,
  accountFilter,
  renderVideoCard,
}: Props) {
  // Smart rush detection : un tag est "role" si présent sur SOME mais pas ALL des assets du dossier.
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
            ? <span className="text-[9px] text-red-400 flex items-center gap-0.5 mb-0.5"><AlertTriangle size={8} /> Dossier désactivé — bloque le tirage</span>
            : <span className="text-[9px] text-muted-foreground flex items-center gap-0.5 mb-0.5"><Lock size={8} /> Hors accès pour ce compte</span>
        )}
        {/* Dossier name */}
        {setTag ? (
          <div className="flex items-center gap-1.5">
            <Layers size={11} className="text-danger-200 shrink-0" />
            <span className="text-xs font-semibold text-gray-800 truncate" title={setTag}>{setTag}</span>
          </div>
        ) : (
          <span className="text-xs font-medium text-muted-foreground italic">(sans dossier)</span>
        )}
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] text-muted-foreground">
            {accessibleCount ?? groupAssets.length} rush{(accessibleCount ?? groupAssets.length) !== 1 ? "es" : ""}
          </span>
        </div>
        {lastUsed && (
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
