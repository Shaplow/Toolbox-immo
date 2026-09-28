"use client";

/**
 * MediaPickCell — une cellule de la bande de médias d'une ligne BulkRenderRow.
 *
 * Affiche le pick tiré par l'aperçu (`previewBulkRenders`) pour un bloc vidéo
 * ou musique, et permet de le remplacer via le même `LibraryPickerModal` que
 * le formulaire de génération unitaire (`LibraryFieldInput`) — mêmes filtres
 * de tags déjà résolus (`media.picker`), donc les mêmes assets proposés.
 */

import { useState } from "react";
import { Music2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { MediaThumb } from "@/components/admin/libraries/mediaAssets/list/MediaThumb";
import { LibraryPickerModal } from "@/components/form/LibraryPicker";
import type { BulkRenderMedia } from "@/types/bulkRender";
import type { LibraryAssetOption } from "@/types/libraryPrefill";

interface Props {
  media: BulkRenderMedia;
  disabled?: boolean;
  /** « Aussi utilisé : jeu. 14:00 · @compte » — même asset dans une autre ligne cochée. */
  duplicateLabel?: string | null;
  onChange: (asset: LibraryAssetOption) => void;
}

export function MediaPickCell({ media, disabled, duplicateLabel, onChange }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const asset = media.asset;
  const isVideo = media.kind === "video";

  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5 min-w-0 max-w-full">
      {/* Vignette / icône */}
      {asset ? (
        isVideo ? (
          <MediaThumb url={asset.url} posterUrl={asset.posterUrl} className="w-12 aspect-[9/16] shrink-0" />
        ) : (
          <div className="h-8 w-8 shrink-0 rounded-md bg-info-50 border border-info-100 flex items-center justify-center">
            <Music2 size={14} className="text-info-600" />
          </div>
        )
      ) : (
        <div
          className={
            isVideo
              ? "w-12 aspect-[9/16] shrink-0 rounded bg-muted"
              : "h-8 w-8 shrink-0 rounded-md bg-muted"
          }
        />
      )}

      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium text-foreground truncate" title={media.label}>
          {media.label}
        </p>
        {asset ? (
          <>
            <p className="text-[10px] text-muted-foreground truncate" title={asset.filename}>
              {asset.filename}
              {asset.setTag ? ` · ${asset.setTag}` : ""}
            </p>
            {!isVideo && (
              // preload="none" : jusqu'à 30 lignes affichées en même temps —
              // charger l'audio de chacune au montage saturerait la connexion.
              <audio key={asset.url} src={asset.url} preload="none" controls className="mt-1 h-6 w-40" />
            )}
          </>
        ) : (
          <Badge size="sm">Tiré au rendu</Badge>
        )}
        {duplicateLabel && (
          <p className="mt-1">
            <Badge variant="warning" size="sm">
              {duplicateLabel}
            </Badge>
          </p>
        )}
      </div>

      {media.locked ? (
        // Le rendu re-résout ce bloc depuis la valeur du select metadata-driven
        // (vidéo du bien) — un « Changer » ici serait ignoré au lancement, donc
        // pas de bouton qui promettrait un changement qui ne prendrait pas.
        <span className="text-[10px] text-muted-foreground shrink-0 text-right max-w-[6rem]">
          Imposé par le bien
        </span>
      ) : (
        <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setPickerOpen(true)}>
          Changer
        </Button>
      )}

      <LibraryPickerModal
        libraryId={media.libraryId}
        isOpen={pickerOpen}
        currentAssetId={asset?.id ?? null}
        isVideo={isVideo}
        onClose={() => setPickerOpen(false)}
        onSelect={(picked) => onChange(picked)}
        tagFilter={media.picker.tagFilter}
        tagConditions={media.picker.tagConditions}
        tagConditionsOperator={media.picker.tagConditionsOperator}
        tagFilterLiteral={media.picker.tagFilterLiteral}
        accountId={media.picker.accountId}
        minDuration={media.picker.minDuration}
      />
    </div>
  );
}
