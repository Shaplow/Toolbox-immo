"use client";

import { ChevronDown, Download, FileJson, MoreHorizontal, Play, Plus, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ButtonIcon } from "@/components/ui/ButtonIcon";
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { Progress } from "@/components/ui/Progress";
import { Tooltip } from "@/components/ui/Tooltip";
import { batchLabel, type BatchDownloadFormat } from "@/lib/transcription/batches";
import { TranscriptionJobRow, type RowBusy } from "./TranscriptionJobRow";
import type { BatchRow, WorkspaceBatch, WorkspaceBatchSummary } from "./workspaceModel";

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}

function launchLabel(ready: number): string {
  if (ready === 0) return "Lancer";
  if (ready === 1) return "Lancer la vidéo prête";
  return `Lancer les ${ready} prêtes`;
}

/**
 * Un lot : compteurs, réglage « intervenants » pour toutes les vidéos pas
 * encore lancées, lancement en un clic, ZIP des SRT (ou des JSON).
 */
export function TranscriptionBatchCard({
  batch,
  summary,
  expanded,
  onToggleExpanded,
  diarizationAvailable,
  launching,
  downloading,
  rowBusy,
  onToggleDiarization,
  onLaunch,
  onDownload,
  onAddFiles,
  onPatchRow,
  onLaunchRow,
  onCancelRow,
  onDownloadRowSrt,
  onRetryRow,
  onDismissRow,
  onRetryFailedUploads,
  canAddFiles = true,
}: {
  batch: WorkspaceBatch;
  summary: WorkspaceBatchSummary;
  expanded: boolean;
  onToggleExpanded: () => void;
  diarizationAvailable: boolean;
  launching: boolean;
  downloading: BatchDownloadFormat | null;
  rowBusy: (row: BatchRow) => RowBusy;
  onToggleDiarization: (value: boolean) => void;
  onLaunch: () => void;
  onDownload: (format: BatchDownloadFormat) => void;
  onAddFiles: () => void;
  onPatchRow: (row: BatchRow, patch: { language?: string; enable_diarization?: boolean }) => void;
  onLaunchRow: (row: BatchRow) => void;
  onCancelRow: (row: BatchRow) => void;
  onDownloadRowSrt: (row: BatchRow) => void;
  onRetryRow: (row: BatchRow) => void;
  onDismissRow: (row: BatchRow) => void;
  onRetryFailedUploads: () => void;
  /** « Ajouter des vidéos au lot » : masqué depuis une publication (une seule vidéo). */
  canAddFiles?: boolean;
}) {
  const isBatch = batch.batchId !== null;
  const finished = summary.completed + summary.failed;
  const toTranscribe = summary.total - summary.cancelled;
  const title = isBatch
    ? batchLabel(batch.createdAt)
    : (batch.rows[0]?.job?.inputFilename ?? "Transcription");

  const rows = (
    <ul className="divide-y divide-border">
      {batch.rows.map((row) => (
        <TranscriptionJobRow
          key={row.key}
          row={row}
          busy={rowBusy(row)}
          showDate={!isBatch}
          diarizationAvailable={diarizationAvailable}
          onPatch={(patch) => onPatchRow(row, patch)}
          onLaunch={() => onLaunchRow(row)}
          onCancel={() => onCancelRow(row)}
          onDownloadSrt={() => onDownloadRowSrt(row)}
          onRetry={() => onRetryRow(row)}
          onDismiss={() => onDismissRow(row)}
        />
      ))}
    </ul>
  );

  // Job hors lot (pipeline auto, ou antérieur aux lots) : une ligne, sans en-tête de lot.
  if (!isBatch) {
    return (
      <Card padded={false} variant="outline">
        {rows}
      </Card>
    );
  }

  const diarizationDisabled = !summary.configurable || (!diarizationAvailable && summary.diarization === false);

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground" suppressHydrationWarning>
              {title}
            </h2>
            <span className="text-xs text-muted-foreground">{plural(summary.total, "vidéo", "vidéos")}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {summary.uploading > 0 && (
              <Badge variant="info" size="sm">
                {`${summary.uploading} en cours d'envoi`}
              </Badge>
            )}
            {summary.ready > 0 && (
              <Badge size="sm">{plural(summary.ready, "prête", "prêtes")}</Badge>
            )}
            {summary.processing > 0 && (
              <Badge variant="info" size="sm">
                {`${summary.processing} en cours`}
              </Badge>
            )}
            {summary.completed > 0 && (
              <Badge variant="success" size="sm">
                {plural(summary.completed, "terminée", "terminées")}
              </Badge>
            )}
            {summary.failed > 0 && (
              <Badge variant="danger" size="sm">
                {plural(summary.failed, "échec", "échecs")}
              </Badge>
            )}
            {summary.cancelled > 0 && (
              <Badge size="sm">{plural(summary.cancelled, "annulée", "annulées")}</Badge>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {summary.uploadErrors > 1 && (
            <Button size="sm" variant="ghost" icon={RotateCcw} onClick={onRetryFailedUploads}>
              {`Réessayer les ${summary.uploadErrors} envois`}
            </Button>
          )}
          {summary.configurable && (
            <label className="inline-flex items-center gap-2 text-xs font-medium text-foreground">
              <Checkbox
                checked={summary.diarization}
                onChange={onToggleDiarization}
                disabled={diarizationDisabled}
                size="sm"
                label="Identifier les intervenants pour toutes les vidéos pas encore lancées du lot"
              />
              Intervenants (tout le lot)
            </label>
          )}
          {summary.configurable && (
            <Tooltip
              content={
                summary.ready === 0
                  ? "Aucune vidéo prête : attendez la fin des envois"
                  : summary.uploading > 0
                    ? `${plural(summary.uploading, "vidéo encore en cours d'envoi", "vidéos encore en cours d'envoi")} : à lancer ensuite`
                    : "Lance toutes les vidéos prêtes du lot"
              }
            >
              <Button
                size="sm"
                icon={Play}
                loading={launching}
                disabled={summary.ready === 0}
                onClick={onLaunch}
              >
                {launchLabel(summary.ready)}
              </Button>
            </Tooltip>
          )}
          <Button
            size="sm"
            variant="secondary"
            icon={Download}
            loading={downloading === "srt"}
            disabled={summary.completed === 0}
            onClick={() => onDownload("srt")}
          >
            {`Télécharger les SRT (${summary.completed})`}
          </Button>
          <DropdownMenu
            align="end"
            trigger={<ButtonIcon icon={MoreHorizontal} size="sm" label="Autres actions du lot" />}
            items={[
              {
                label: `Télécharger les JSON (${summary.completed})`,
                icon: FileJson,
                disabled: summary.completed === 0 || downloading !== null,
                onClick: () => onDownload("json"),
              },
              ...(canAddFiles ? [{ label: "Ajouter des vidéos au lot", icon: Plus, onClick: onAddFiles }] : []),
            ]}
          />
          <ButtonIcon
            icon={ChevronDown}
            size="sm"
            label={expanded ? "Replier le lot" : "Déplier le lot"}
            aria-expanded={expanded}
            onClick={onToggleExpanded}
            className={expanded ? "rotate-180 transition-transform" : "transition-transform"}
          />
        </div>
      </div>

      {/* Avancement des transcriptions, tant qu'il en tourne (les annulées ne comptent pas). */}
      {summary.processing > 0 && toTranscribe > 0 && (
        <Progress value={finished} max={toTranscribe} size="sm" className="rounded-none" />
      )}

      {expanded && rows}
    </Card>
  );
}
