"use client";

import { memo } from "react";
import { CheckSquare, Square, FolderOpen, Layers } from "lucide-react";
import { MediaThumb } from "./MediaThumb";
import type { MediaAsset } from "../types";

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  } catch {
    return "—";
  }
}

/**
 * MediaAssetRow — une ligne de la vue liste dense (mode noob).
 * Clic sur la ligne → ouvre le détail ; clic sur la checkbox → multi-select.
 */
export const MediaAssetRow = memo(function MediaAssetRow({
  asset,
  selected,
  onToggleSelect,
  onOpenDetail,
}: {
  asset: MediaAsset;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onOpenDetail: (asset: MediaAsset) => void;
}) {
  const realSet = asset.setTag && !asset.setTag.startsWith("pack_") ? asset.setTag : null;
  const accessLabel =
    asset.accessAccountIds.length === 0
      ? "Global"
      : `${asset.accessAccountIds.length} compte${asset.accessAccountIds.length > 1 ? "s" : ""}`;

  return (
    <tr
      onClick={() => onOpenDetail(asset)}
      className={`group cursor-pointer border-t border-border transition-colors ${
        selected ? "bg-primary/5" : "hover:bg-muted/60"
      }`}
    >
      {/* Checkbox */}
      <td
        className="px-2 py-1.5 align-middle"
        onClick={(e) => {
          e.stopPropagation();
          onToggleSelect(asset.id);
        }}
      >
        {selected ? (
          <CheckSquare size={15} className="text-primary" />
        ) : (
          <Square size={15} className="text-muted-foreground/50 group-hover:text-muted-foreground" />
        )}
      </td>

      {/* Thumbnail */}
      <td className="px-2 py-1.5">
        <MediaThumb
          url={asset.url}
          posterUrl={asset.posterUrl}
          pending={!!asset.pendingEditJob}
          disabled={asset.disabled}
          className="w-9 h-12 shrink-0"
        />
      </td>

      {/* Nom */}
      <td className="px-2 py-1.5 max-w-[220px]">
        <p className="text-[12.5px] text-foreground truncate" title={asset.filename}>
          {asset.filename}
        </p>
      </td>

      {/* Catégorie (chip neutre) */}
      <td className="px-2 py-1.5">
        {asset.category ? (
          <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-muted text-foreground border border-border">
            <FolderOpen size={9} /> {asset.category}
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground/50">—</span>
        )}
      </td>

      {/* Groupe (chip accent si réel) */}
      <td className="px-2 py-1.5">
        {realSet ? (
          <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
            <Layers size={9} /> {realSet}
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground/50">—</span>
        )}
      </td>

      {/* Tags */}
      <td className="px-2 py-1.5 max-w-[160px]">
        {asset.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {asset.tags.slice(0, 3).map((t) => (
              <span
                key={t}
                className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground"
              >
                {t}
              </span>
            ))}
            {asset.tags.length > 3 && (
              <span className="text-[10px] text-muted-foreground/60">+{asset.tags.length - 3}</span>
            )}
          </div>
        ) : (
          <span className="text-[11px] text-muted-foreground/50">—</span>
        )}
      </td>

      {/* Usage */}
      <td className="px-2 py-1.5 whitespace-nowrap text-[11.5px] text-muted-foreground tabular-nums">
        {asset.usageCount}× · {shortDate(asset.lastUsedAt)}
      </td>

      {/* Accès */}
      <td className="px-2 py-1.5 whitespace-nowrap text-[11.5px] text-muted-foreground">
        {accessLabel}
      </td>
    </tr>
  );
});
