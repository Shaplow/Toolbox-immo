"use client";

/**
 * MediaAssetsSetStack — représentation visuelle d'un set (groupe d'assets
 * partageant un même setTag dans une catégorie) en mode noob.
 *
 * Phase rotation refonte (2026-05-30) : remplace les sub-cards historiques
 * par une stack visuelle : 1 vignette dominante + badge "+N" overlay si plus
 * d'un asset dans le set. Footer compact : "N plans · Pack" (pack en italique
 * gris si auto). Click → callback (le parent décide : ouvre 1er asset, deploy
 * inline, drawer set dédié…).
 *
 * Cas N=1 : la stack ressemble à une card asset normale (pas de badge).
 * Cas N>1 : badge "+N" + offset visuel léger pour suggérer la pile.
 */

import { Play, Layers, AlertTriangle, EyeOff } from "lucide-react";
import { LazyVideoThumb } from "./LazyVideoThumb";
import type { SetGroup } from "./types";

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
  const isPackAuto = !setTag || setTag.startsWith("pack_");
  const dimmedByAccount = !!accountFilter && !isAccessible;

  if (!primary) return null;

  return (
    <button
      type="button"
      onClick={() => onClick?.(group)}
      className={[
        "group/stack relative w-full rounded-2xl overflow-hidden transition-all text-left",
        "bg-gradient-to-b from-white/85 to-white/55 backdrop-blur-[8px] backdrop-saturate-150",
        dimmedByAccount ? "opacity-50" : "",
        "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.45),inset_0_0_0_1px_rgba(15,23,42,0.06),0_1px_2px_rgba(15,23,42,0.04)]",
        "hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.55),inset_0_0_0_1px_rgba(15,23,42,0.1),0_4px_12px_-4px_rgba(15,23,42,0.12)] hover:-translate-y-0.5",
        "focus-ring",
      ].filter(Boolean).join(" ")}
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
        <LazyVideoThumb url={primary.url} className="w-full h-full object-cover" />
        {/* Play overlay au hover (lance le 1er asset implicitement). */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover/stack:bg-black/20 transition-colors pointer-events-none">
          <span className="opacity-0 group-hover/stack:opacity-100 transition-opacity inline-flex h-9 w-9 rounded-full bg-white/95 backdrop-blur-[6px] items-center justify-center shadow-[0_2px_4px_rgba(15,23,42,0.12),0_8px_24px_-4px_rgba(15,23,42,0.18)]">
            <Play size={14} className="text-gray-900 ml-0.5" fill="currentColor" />
          </span>
        </div>
        {/* Badge +N en haut-right si plusieurs assets. */}
        {total > 1 && (
          <span className="absolute top-2 right-2 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-white/90 backdrop-blur-[6px] text-[10px] font-semibold text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.1),0_2px_4px_rgba(15,23,42,0.12)]">
            <Layers size={9} className="text-gray-500" />+{total - 1}
          </span>
        )}
        {/* État disabled (tous les assets désactivés). */}
        {allDisabled && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-peach-900/40 gap-1 pointer-events-none z-10">
            <EyeOff size={18} className="text-peach-100" />
            <span className="text-[10px] text-peach-50 font-medium">Désactivé</span>
          </div>
        )}
        {/* Hors accès pour le compte filtré. */}
        {dimmedByAccount && !allDisabled && (
          <div className="absolute bottom-2 left-2 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-white/85 backdrop-blur-[6px] text-[9.5px] text-gray-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
            <AlertTriangle size={9} />Hors accès
          </div>
        )}
      </div>
      {/* Footer compact : N plans · Pack name. */}
      <div className="px-2.5 py-2 flex items-center justify-between gap-1.5">
        <p className="text-[11px] text-gray-600 truncate min-w-0">
          {total === 1 ? "1 plan" : `${total} plans`}
          {accountFilter && accessibleCount !== total && (
            <span className="text-gray-400"> · {accessibleCount} accessible{accessibleCount !== 1 ? "s" : ""}</span>
          )}
        </p>
        <span
          className={[
            "text-[10.5px] truncate shrink min-w-0 max-w-[60%]",
            isPackAuto ? "text-gray-400 italic" : "text-rose-700 font-medium",
          ].join(" ")}
          title={setTag ?? undefined}
        >
          {isPackAuto ? "auto" : setTag}
        </span>
      </div>
    </button>
  );
}
