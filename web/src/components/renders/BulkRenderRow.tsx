"use client";

/**
 * BulkRenderRow — une ligne de la modale « Lancer les rendus ».
 *
 * Ready : Checkbox + bande de médias éditable (MediaPickCell) + extrait data.
 * Non-ready : grisée, badge de raison (texte exact du serveur, voir
 * `bulkRenderService.ts`) + lien « Ouvrir le formulaire ».
 */

import Link from "next/link";
import { Checkbox } from "@/components/ui/Checkbox";
import { Badge } from "@/components/ui/Badge";
import { AccountLabel } from "@/components/ui/AccountLabel";
import { timeFr } from "@/lib/date/formatFr";
import { MediaPickCell } from "./MediaPickCell";
import type { BulkRenderRow as BulkRenderRowType, BulkRenderLaunchResult } from "@/types/bulkRender";
import type { LibraryAssetOption } from "@/types/libraryPrefill";

interface Props {
  row: BulkRenderRowType;
  checked: boolean;
  onToggleChecked: (checked: boolean) => void;
  onChangeMedia: (blockId: string, asset: LibraryAssetOption) => void;
  /** Résout le libellé « Aussi utilisé : … » pour un media donné, ou null. */
  duplicateLabelFor: (blockId: string, usageKey: string, assetId: string) => string | null;
  launchResult: BulkRenderLaunchResult | null;
  disabled?: boolean;
}

export function BulkRenderRow({
  row,
  checked,
  onToggleChecked,
  onChangeMedia,
  duplicateLabelFor,
  launchResult,
  disabled,
}: Props) {
  const isReady = row.status === "ready";
  const failed = launchResult !== null && !launchResult.ok;
  // Lancée avec succès (lot partiel, modale restée ouverte pour les échecs) :
  // plus rien à cocher ni à changer sur cette ligne — un second clic ne doit
  // jamais la relancer, et elle ne doit plus se confondre avec une ligne
  // simplement décochée (En retard…).
  const launchedOk = launchResult !== null && launchResult.ok;

  return (
    <div
      className={[
        "rounded-lg border px-3 py-2.5",
        isReady ? "border-border bg-card" : "border-border bg-muted/40",
      ].join(" ")}
    >
      <div className="flex items-center gap-2.5">
        {isReady ? (
          <Checkbox
            checked={checked}
            onChange={onToggleChecked}
            size="sm"
            label={`Sélectionner ${row.recipeLabel}`}
            disabled={disabled || launchedOk}
          />
        ) : (
          <span className="w-4 h-4 shrink-0" aria-hidden />
        )}
        <span className="text-[12px] font-mono tabular-nums text-foreground shrink-0">
          {row.scheduledAt ? timeFr(row.scheduledAt) : "—"}
        </span>
        <AccountLabel handle={row.account?.handle} className="text-[12px] text-foreground shrink-0" />
        <span
          className={`text-[12px] truncate min-w-0 ${isReady ? "text-muted-foreground" : "text-muted-foreground/70"}`}
          title={row.recipeLabel}
        >
          {row.recipeLabel}
        </span>

        <div className="ml-auto flex items-center gap-2 shrink-0">
          {launchedOk && <Badge variant="success">Lancé</Badge>}
          {isReady && !launchedOk && row.overdue && <Badge variant="warning">En retard</Badge>}
          {!isReady && row.reason && <Badge>{row.reason}</Badge>}
          {!isReady && row.formHref && (
            <Link
              href={row.formHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-primary hover:underline shrink-0"
            >
              Ouvrir le formulaire
            </Link>
          )}
        </div>
      </div>

      {row.media.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {row.media.map((m) => (
            <MediaPickCell
              key={m.blockId}
              media={m}
              disabled={disabled || launchedOk}
              duplicateLabel={m.asset ? duplicateLabelFor(m.blockId, m.usageKey, m.asset.id) : null}
              onChange={(asset) => onChangeMedia(m.blockId, asset)}
            />
          ))}
        </div>
      )}

      {row.data && (
        <p className="mt-2 text-[11px] text-muted-foreground line-clamp-2" title={row.data.excerpt}>
          {row.data.excerpt}
        </p>
      )}

      {failed && (
        <p className="mt-2 text-[11px] text-danger-700">
          {launchResult?.error ?? "Erreur au lancement"}
        </p>
      )}
    </div>
  );
}
