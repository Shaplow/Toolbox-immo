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
    <div className="sticky top-0 z-10 mb-3 p-3 rounded-2xl bg-gradient-to-b from-warning-50/85 via-warning-50/55 to-white/55  flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="shrink-0 h-8 w-8 rounded-full bg-gradient-to-b from-warning-100 to-warning-200/80 inline-flex items-center justify-center text-warning-700 ">
          <AlertCircle size={14} />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-warning-700 leading-tight truncate">
            {orphanCount} fichier{orphanCount > 1 ? "s" : ""} à ranger
          </p>
          <p className="text-[11px] text-warning-700/80 leading-tight">
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
