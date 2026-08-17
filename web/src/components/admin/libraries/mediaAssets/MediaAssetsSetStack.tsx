"use client";

/**
 * MediaAssetsSetStack — représentation visuelle d'un dossier (assets
 * partageant un même setTag) en mode simple.
 *
 * Stack visuelle : 1 vignette dominante + badge "+N" overlay si plus d'un
 * asset dans le dossier. Footer compact : "N plans · Dossier" (ou
 * « (sans dossier) » pour le bucket sans setTag). Click → callback (le
 * parent décide : ouvre 1er asset, drawer détail…).
 *
 * Cas N=1 : la stack ressemble à une card asset normale (pas de badge).
 * Cas N>1 : badge "+N" + offset visuel léger pour suggérer la pile.
 */

import { Play, Layers, AlertTriangle, EyeOff, Download } from "lucide-react";
import { LazyVideoThumb } from "./LazyVideoThumb";
import type { SetGroup } from "./types";
import { downloadAssets } from "./downloadAssets";
import { isReservedSetTag } from "@/lib/rotation/sentinels";

interface Props {
  group: SetGroup;
  onClick?: (group: SetGroup) => void;
  /** Filtre compte actif — affecte l'opacity si set inaccessible. */
  accountFilter?: string | null;
}

export function MediaAssetsSetStack({ group, onClick, accountFilter }: Props) {
  const { groupAssets, setTag, accessibleCount, isAccessible } = group;
  const total = groupAssets.length;
  // Tri stable par createdAt asc pour avoir une vignette dominante constante.
  const sorted = [...groupAssets].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const primary = sorted[0];
  const allDisabled = groupAssets.every((a) => a.disabled);
  const isFolderAuto = isReservedSetTag(setTag);
  const dimmedByAccount = !!accountFilter && !isAccessible;

  if (!primary) return null;

  return (
    // Wrapper <div> et non <button> : le bouton « télécharger le groupe » est un
    // FRÈRE du bouton d'ouverture. Deux <button> imbriqués sont du HTML invalide
    // (et le clic interne est avalé par l'externe selon les navigateurs).
    <div
      className={[
        "group/stack relative w-full rounded-2xl overflow-hidden transition-all",
        "bg-card border border-border ",
        dimmedByAccount ? "opacity-50" : "",
        "hover: hover:-translate-y-0.5",
      ].filter(Boolean).join(" ")}
    >
      <button
        type="button"
        onClick={() => onClick?.(group)}
        className="block w-full text-left focus-ring"
      >
      {/* Thumbnail principale + suggestion stack (offset arrière). */}
      <div className="relative aspect-[9/16] bg-gray-200">
        {/* Couche arrière fake : 2 décalages discrets pour suggérer une pile (uniquement si N > 1). */}
        {total > 1 && (
          <>
            <div className="absolute top-1 right-1 bottom-1 left-1 rounded-xl bg-white/80 shadow-[0_1px_2px_rgba(15,23,42,0.08),inset_0_0_0_1px_rgba(15,23,42,0.05)] -z-10" aria-hidden />
            {total > 2 && (
              <div className="absolute top-2 right-2 bottom-2 left-2 rounded-xl bg-white/60 shadow-[0_1px_2px_rgba(15,23,42,0.06),inset_0_0_0_1px_rgba(15,23,42,0.04)] -z-20" aria-hidden />
            )}
          </>
        )}
        <LazyVideoThumb url={primary.url} posterUrl={primary.posterUrl} className="w-full h-full object-cover" />
        {/* Play overlay au hover (lance le 1er asset implicitement). */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover/stack:bg-black/20 transition-colors pointer-events-none">
          <span className="opacity-0 group-hover/stack:opacity-100 transition-opacity inline-flex h-9 w-9 rounded-full bg-card border border-border items-center justify-center shadow-[0_2px_4px_rgba(15,23,42,0.12),0_8px_24px_-4px_rgba(15,23,42,0.18)]">
            <Play size={14} className="text-gray-900 ml-0.5" fill="currentColor" />
          </span>
        </div>
        {/* Badge +N en haut-right si plusieurs assets. */}
        {total > 1 && (
          <span className="absolute top-2 right-2 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-card border border-border text-[10px] font-semibold text-gray-900 ">
            <Layers size={9} className="text-muted-foreground" />+{total - 1}
          </span>
        )}
        {/* État disabled (tous les assets désactivés). */}
        {allDisabled && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-warning-700/40 gap-1 pointer-events-none z-10">
            <EyeOff size={18} className="text-warning-100" />
            <span className="text-[10px] text-warning-50 font-medium">Désactivé</span>
          </div>
        )}
        {/* Hors accès pour le compte filtré. */}
        {dimmedByAccount && !allDisabled && (
          <div className="absolute bottom-2 left-2 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-card border border-border text-[9.5px] text-muted-foreground ">
            <AlertTriangle size={9} />Hors accès
          </div>
        )}
      </div>
      {/* Footer compact : N plans · Dossier (nommé, ou « sans dossier »). */}
      <div className="px-2.5 py-2 flex items-center justify-between gap-1.5">
        <p className="text-[11px] text-muted-foreground truncate min-w-0">
          {total === 1 ? "1 plan" : `${total} plans`}
          {accountFilter && accessibleCount !== total && (
            <span className="text-muted-foreground"> · {accessibleCount} accessible{accessibleCount !== 1 ? "s" : ""}</span>
          )}
        </p>
        {!isFolderAuto && setTag ? (
          <span
            className="text-[10.5px] truncate shrink min-w-0 max-w-[60%] text-foreground font-medium"
            title={setTag}
          >
            {setTag}
          </span>
        ) : !setTag ? (
          <span className="text-[10.5px] text-muted-foreground italic shrink min-w-0">(sans dossier)</span>
        ) : null}
      </div>
      </button>

      {/* Télécharger tout le groupe — hors du bouton d'ouverture (cf. plus haut). */}
      <button
        type="button"
        onClick={() => void downloadAssets(groupAssets.map((a) => ({ id: a.id, filename: a.filename })))}
        className="absolute top-2 left-2 z-20 w-7 h-7 rounded-full bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-info-700 hover:bg-info-50 opacity-0 group-hover/stack:opacity-100 transition-opacity shadow"
        title={total === 1 ? "Télécharger le plan" : `Télécharger les ${total} plans du groupe`}
        aria-label={total === 1 ? "Télécharger le plan" : `Télécharger les ${total} plans du groupe`}
      >
        <Download size={13} />
      </button>
    </div>
  );
}
