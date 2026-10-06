"use client";

/**
 * Suivi d'un téléchargement en cours : barre globale, débit et temps restant,
 * fichiers en cours d'écriture, arrêt.
 */

import { Square } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Progress } from "@/components/ui/Progress";
import { formatMaxSize } from "@/lib/upload/limits";
import type { EngineActiveFile, EngineProgress } from "@/lib/clientExport/downloadEngine";
import { computeProgressView, formatCount, formatDuration, formatRate, fullPath, plural, shortPath } from "./exportModel";

interface ExportProgressCardProps {
  /** null jusqu'au premier instantané du moteur. */
  progress: EngineProgress | null;
  /** Débit lissé en octets/s. */
  rate: number | null;
  stopping: boolean;
  connectionIssue: boolean;
  folderName: string;
  /** Totaux du manifeste, montrés avant le premier instantané. */
  totalFiles: number;
  totalBytes: number;
  onStop: () => void;
}

function activeFileStatus(file: EngineActiveFile): string {
  if (file.phase === "finalizing") return "Finalisation…";
  if (file.size && file.size > 0) return `${formatMaxSize(file.received)} / ${formatMaxSize(file.size)}`;
  return formatMaxSize(file.received);
}

export function ExportProgressCard({
  progress,
  rate,
  stopping,
  connectionIssue,
  folderName,
  totalFiles,
  totalBytes,
  onStop,
}: ExportProgressCardProps) {
  const view = progress ? computeProgressView(progress, rate ?? 0) : null;
  const files = progress?.totalFiles ?? totalFiles;
  const bytes = progress?.totalBytes ?? totalBytes;
  const doneFiles = progress?.doneFiles ?? 0;
  const percent = view ? Math.floor(view.fraction * 100) : 0;

  let pace = "Calcul du temps restant…";
  if (view && rate !== null && rate > 0) {
    pace = formatRate(rate);
    if (view.etaSeconds !== null && view.fraction < 1) {
      // « environ » seulement quand on annonce des minutes ou des heures.
      const approx = view.etaSeconds >= 45 ? "environ " : "";
      pace += ` · temps restant estimé : ${approx}${formatDuration(view.etaSeconds)}`;
    }
  }

  return (
    <Card className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <h2 className="text-base font-semibold text-foreground">Téléchargement en cours</h2>
          <p className="break-words text-[13px] text-muted-foreground">
            Les fichiers arrivent dans « {folderName} », rangés par compte.
          </p>
        </div>
        <Button variant="outline" size="sm" icon={Square} loading={stopping} onClick={onStop}>
          {stopping ? "Arrêt en cours…" : "Arrêter"}
        </Button>
      </div>

      <div role="group" aria-label="Progression du téléchargement" className="space-y-1.5">
        {/* Valeur non arrondie : sur 150 Go, un pour cent vaut 1,5 Go et la barre resterait figée des minutes. */}
        <Progress size="lg" value={view ? view.fraction * 100 : 0} indeterminate={!progress} />
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[13px]">
          <span className="font-medium tabular-nums text-foreground">
            {bytes > 0 ? `${formatMaxSize(view?.doneBytes ?? 0)} / ${formatMaxSize(bytes)} · ` : ""}
            {percent} %
          </span>
          <span className="tabular-nums text-muted-foreground">
            {formatCount(doneFiles)} / {plural(files, "fichier", "fichiers")}
          </span>
        </div>
        <p className="text-[12px] tabular-nums text-muted-foreground">{pace}</p>
      </div>

      {connectionIssue && (
        <Alert variant="warning" title="Connexion au serveur interrompue">
          Nouvel essai en cours : le téléchargement reprendra tout seul dès que la connexion revient.
        </Alert>
      )}

      {progress && progress.active.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">En cours</p>
          <ul className="space-y-2">
            {progress.active.map((file) => (
              <li key={file.ref} className="space-y-1">
                <div className="flex items-baseline justify-between gap-3 text-[12px]">
                  <span className="min-w-0 truncate text-foreground" title={fullPath(file.path)}>
                    {shortPath(file.path)}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{activeFileStatus(file)}</span>
                </div>
                <Progress
                  size="sm"
                  value={file.phase === "finalizing" ? 100 : file.size ? (file.received / file.size) * 100 : 0}
                  indeterminate={file.size === null && file.phase !== "finalizing"}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[12px] text-muted-foreground">Laisse cette page ouverte et visible, ordinateur branché.</p>
    </Card>
  );
}
