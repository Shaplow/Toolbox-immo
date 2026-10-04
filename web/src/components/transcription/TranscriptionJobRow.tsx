"use client";

import Link from "next/link";
import { Download, FileAudio, Play, RotateCcw, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ButtonIcon } from "@/components/ui/ButtonIcon";
import { Checkbox } from "@/components/ui/Checkbox";
import { Progress } from "@/components/ui/Progress";
import { Select } from "@/components/ui/Select";
import { fmtDuration } from "@/lib/jobUtils";
import { LANGUAGE_CHOICES } from "./TranscriptionNewBatchCard";
import { canLaunchRow, isUploadActive, rowDisplay, type BatchRow } from "./workspaceModel";

const ROW_LANGUAGE_OPTIONS = [
  ...LANGUAGE_CHOICES.map((choice) => ({ value: choice.value, label: choice.label })),
  { value: "auto", label: "Détection auto" },
];

export type RowBusy = "launch" | "cancel" | "download" | "patch" | null;

/**
 * Une vidéo d'un lot : statut (ou progression d'upload), réglages tant qu'elle
 * n'est pas lancée (enregistrés à chaque changement), actions directes — dont
 * le SRT en un clic une fois terminée.
 */
export function TranscriptionJobRow({
  row,
  busy,
  diarizationAvailable,
  onPatch,
  onLaunch,
  onCancel,
  onDownloadSrt,
  onRetry,
  onDismiss,
}: {
  row: BatchRow;
  busy: RowBusy;
  diarizationAvailable: boolean;
  onPatch: (patch: { language?: string; enable_diarization?: boolean }) => void;
  onLaunch: () => void;
  onCancel: () => void;
  onDownloadSrt: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const { job, upload } = row;
  const display = rowDisplay(row);
  const fileName = job?.inputFilename ?? upload?.fileName ?? "Fichier inconnu";
  const uploading = isUploadActive(upload);
  const queued = job?.status === "QUEUED";
  const multilingual = (job?.languages.length ?? 0) >= 2;

  const meta: string[] = [];
  if (job) {
    meta.push(multilingual ? `Multi ${job.languages.join("/").toUpperCase()}` : job.language.toUpperCase());
    if (job.duration != null) meta.push(fmtDuration(job.duration));
    if (job.status === "COMPLETED" && job.hasDiarization) meta.push("Intervenants identifiés");
    if (job.status === "COMPLETED" && job.enableDiarization && !job.hasDiarization) {
      meta.push("Intervenants non identifiés");
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
      <div className="flex min-w-0 flex-1 basis-64 items-center gap-3">
        <FileAudio size={16} className="shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground" title={fileName}>
            {fileName}
          </p>
          {display.progress !== null ? (
            <Progress value={display.progress * 100} size="sm" className="mt-1.5 max-w-xs" />
          ) : meta.length > 0 ? (
            <p className="truncate text-xs text-muted-foreground">{meta.join(" · ")}</p>
          ) : null}
          {display.error && <p className="mt-0.5 text-xs text-danger-700">{display.error}</p>}
        </div>
      </div>

      {queued && job && (
        <div className="flex items-center gap-3">
          {!multilingual && (
            <Select
              value={job.language}
              onChange={(language) => onPatch({ language })}
              options={ROW_LANGUAGE_OPTIONS}
              disabled={busy !== null}
              className="w-36"
            />
          )}
          <label className="inline-flex items-center gap-2 text-xs text-foreground">
            <Checkbox
              checked={job.enableDiarization}
              onChange={(value) => onPatch({ enable_diarization: value })}
              disabled={busy !== null || (!diarizationAvailable && !job.enableDiarization)}
              size="sm"
              label={`Identifier les intervenants : ${fileName}`}
            />
            Intervenants
          </label>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Badge variant={display.variant} size="sm">
          {display.label}
        </Badge>

        {job && canLaunchRow(row) && (
          <Button size="sm" variant="secondary" icon={Play} loading={busy === "launch"} onClick={onLaunch}>
            Lancer
          </Button>
        )}
        {job?.status === "COMPLETED" && (
          <Button size="sm" variant="secondary" icon={Download} loading={busy === "download"} onClick={onDownloadSrt}>
            SRT
          </Button>
        )}
        {upload?.phase === "error" && (
          <Button size="sm" variant="ghost" icon={RotateCcw} onClick={onRetry}>
            Réessayer
          </Button>
        )}
        {job && !uploading && job.status !== "QUEUED" && (
          <Link
            href={`/transcriptions/${job.id}`}
            className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Détail
          </Link>
        )}
        {/* Jamais pour un job du pipeline auto : sa source est la vidéo de la publication. */}
        {(uploading || (!job?.isAuto && (job?.status === "QUEUED" || job?.status === "PROCESSING"))) && (
          <ButtonIcon
            icon={X}
            size="sm"
            label={uploading ? `Annuler l'envoi de ${fileName}` : `Annuler ${fileName}`}
            loading={busy === "cancel"}
            onClick={onCancel}
          />
        )}
        {!job && upload?.phase === "error" && (
          <ButtonIcon icon={X} size="sm" label={`Retirer ${fileName}`} onClick={onDismiss} />
        )}
      </div>
    </li>
  );
}
