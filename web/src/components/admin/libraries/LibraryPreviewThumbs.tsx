"use client";

/**
 * LibraryPreviewThumbs — mini-aperçu 2×2 d'une MediaLibrary affiché dans
 * MediaLibraryCard pour rendre la card identifiable d'un coup d'œil.
 *
 * Phase 4 médiathèque (2026-05-30). Vidéo : grille 2×2 de LazyVideoThumb
 * (ou cases vides si moins de 4 assets). Audio : icône Music2 stylisée
 * centrée (waveform skip, complexité non justifiée pour 4 items max).
 *
 * Les preview assets viennent de l'endpoint GET /api/admin/libraries/media
 * (jusqu'à 4 derniers `disabled=false` par lib, fields { id, url, mimeType }).
 */

import { Music2, Video as VideoIcon } from "lucide-react";
import { LazyVideoThumb } from "./mediaAssets/LazyVideoThumb";

export interface PreviewAsset {
  id: string;
  url: string;
  mimeType: string;
}

interface Props {
  type: "video" | "audio";
  previewAssets: PreviewAsset[];
}

export function LibraryPreviewThumbs({ type, previewAssets }: Props) {
  const isVideo = type === "video";

  if (!isVideo) {
    return (
      <div className="aspect-[16/9] rounded-lg overflow-hidden bg-success-50 flex items-center justify-center ">
        {previewAssets.length === 0 ? (
          <div className="flex flex-col items-center gap-1 text-success-600/60">
            <Music2 size={22} />
            <span className="text-[9.5px] uppercase tracking-widest font-medium">vide</span>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <Music2 size={22} className="text-success-700" />
            <span className="text-[12px] font-semibold text-success-700 tabular-nums">
              {previewAssets.length}+
            </span>
          </div>
        )}
      </div>
    );
  }

  if (previewAssets.length === 0) {
    return (
      <div className="aspect-[16/9] rounded-lg overflow-hidden bg-info-50 flex items-center justify-center ">
        <div className="flex flex-col items-center gap-1 text-info-600/60">
          <VideoIcon size={22} />
          <span className="text-[9.5px] uppercase tracking-widest font-medium">vide</span>
        </div>
      </div>
    );
  }

  // Grille 2×2 — chaque case affiche une vidéo (ou un placeholder gris si
  // moins de 4 assets disponibles).
  const slots: Array<PreviewAsset | null> = [0, 1, 2, 3].map(
    (i) => previewAssets[i] ?? null,
  );

  return (
    <div className="aspect-[16/9] rounded-lg overflow-hidden bg-gray-900/5 grid grid-cols-2 grid-rows-2 gap-0.5 ">
      {slots.map((asset, idx) =>
        asset ? (
          <div key={asset.id} className="overflow-hidden bg-gray-900/85">
            <LazyVideoThumb url={asset.url} className="w-full h-full object-cover" />
          </div>
        ) : (
          <div
            key={`empty-${idx}`}
            className="bg-gray-100"
          />
        ),
      )}
    </div>
  );
}
