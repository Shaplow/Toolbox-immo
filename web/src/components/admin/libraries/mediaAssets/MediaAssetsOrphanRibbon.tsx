"use client";

/**
 * MediaAssetsOrphanRibbon — bandeau sticky qui s'affiche en haut du
 * MediaAssetsPanel quand des assets ont `category === null` (orphelins).
 *
 * Phase 2 médiathèque (2026-05-30). Le ribbon rend visible le problème
 * (sinon l'user upload sans catégorie, les assets ne sortent pas en
 * rotation, et il croit que tout est OK).
 *
 * Le CTA ouvre `MediaAssetsBulkSortDrawer` qui bulk-assigne une catégorie
 * en 1 décision.
 */

import { AlertCircle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface Props {
  orphanCount: number;
  onSortClick: () => void;
}

export function MediaAssetsOrphanRibbon({ orphanCount, onSortClick }: Props) {
  if (orphanCount === 0) return null;
  return (
    <div className="sticky top-0 z-10 mb-3 p-3 rounded-2xl bg-gradient-to-b from-peach-50/85 via-peach-50/55 to-white/55 backdrop-blur-[10px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.45),inset_0_0_0_1px_rgba(221,140,90,0.22),inset_0_-1px_0_rgba(15,23,42,0.04),0_2px_8px_-4px_rgba(245,158,107,0.18),0_8px_24px_-12px_rgba(15,23,42,0.12)] flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="shrink-0 h-8 w-8 rounded-full bg-gradient-to-b from-peach-100 to-peach-200/80 backdrop-blur-[6px] inline-flex items-center justify-center text-peach-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.8),inset_0_0_0_1px_rgba(221,140,90,0.18),0_2px_4px_-1px_rgba(245,158,107,0.32)]">
          <AlertCircle size={14} />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-peach-900 leading-tight truncate">
            {orphanCount} fichier{orphanCount > 1 ? "s" : ""} à ranger
          </p>
          <p className="text-[11px] text-peach-700/80 leading-tight">
            Sans catégorie, ils n&apos;entrent pas en rotation automatique.
          </p>
        </div>
      </div>
      <Button variant="primary" size="sm" onClick={onSortClick} icon={ArrowRight}>
        Choisir une catégorie
      </Button>
    </div>
  );
}
