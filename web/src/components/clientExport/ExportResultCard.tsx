"use client";

/**
 * Fin d'une session de téléchargement, selon la raison rendue par le moteur :
 * terminé (éventuellement avec des échecs), arrêté, disque plein, accès au
 * dossier perdu, lien devenu invalide. Chaque cas dit quoi faire ensuite.
 */

import { Fragment } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleStop,
  FolderDown,
  HardDrive,
  Link2Off,
  RotateCcw,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { formatMaxSize } from "@/lib/upload/limits";
import type { EngineResult, EngineStopReason } from "@/lib/clientExport/downloadEngine";
import { formatCount, fullPath, plural, shortPath } from "./exportModel";

type Tone = "success" | "neutral" | "warning" | "danger";

interface Headline {
  title: string;
  icon: LucideIcon;
  tone: Tone;
}

const TONE_ICON_CLASS: Record<Tone, string> = {
  success: "text-success-600",
  neutral: "text-muted-foreground",
  warning: "text-warning-600",
  danger: "text-danger-600",
};

const HEADLINES: Record<EngineStopReason, Headline> = {
  done: { title: "Téléchargement terminé", icon: CheckCircle2, tone: "success" },
  aborted: { title: "Téléchargement arrêté", icon: CircleStop, tone: "neutral" },
  disk_full: { title: "Ton disque est plein", icon: HardDrive, tone: "danger" },
  permission_lost: { title: "L'accès au dossier a été perdu", icon: ShieldAlert, tone: "warning" },
  link_gone: { title: "Ce lien n'est plus valide", icon: Link2Off, tone: "danger" },
};

/** Au-delà, la liste se résume : des milliers de lignes ne s'ouvriraient plus. */
const MAX_LISTED_ISSUES = 100;

interface IssueItem {
  key: string;
  label: string;
  title: string;
  detail?: string;
}

function IssueList({ items }: { items: IssueItem[] }) {
  const shown = items.slice(0, MAX_LISTED_ISSUES);
  return (
    <ul className="mt-1.5 max-h-48 space-y-1 overflow-y-auto">
      {shown.map((item) => (
        <li key={item.key} className="break-words">
          <span className="text-foreground" title={item.title}>
            {item.label}
          </span>
          {item.detail && <span> — {item.detail}</span>}
        </li>
      ))}
      {items.length > shown.length && <li>… et {formatCount(items.length - shown.length)} autres</li>}
    </ul>
  );
}

function describe(result: EngineResult, folderName: string): string {
  const failed = result.failures.length > 0 || result.report.failed > 0;
  const missing = result.missing.length > 0 || result.report.missing > 0;
  switch (result.reason) {
    case "done":
      if (failed) return "Certains fichiers n'ont pas pu être enregistrés : réessaie-les avec le bouton ci-dessous.";
      if (missing) return `Le reste est dans le dossier « ${folderName} ». Certains fichiers ne sont plus disponibles.`;
      return `Tes fichiers sont dans le dossier « ${folderName} », rangés par compte. Tu peux fermer cette page.`;
    case "aborted":
      return "Les fichiers déjà enregistrés ne seront pas téléchargés une seconde fois.";
    case "disk_full":
      return "Libère de la place puis reprends : les fichiers déjà enregistrés ne seront pas refaits.";
    case "permission_lost":
      return `Chrome a retiré l'autorisation d'écrire dans « ${folderName} », par exemple après une longue période en arrière-plan. Autorise à nouveau l'accès pour continuer.`;
    case "link_gone":
      return "Demande un nouveau lien à ton interlocuteur pour récupérer le reste. Les fichiers déjà enregistrés restent dans ton dossier.";
  }
}

interface ExportResultCardProps {
  result: EngineResult;
  /** Nombre de fichiers du manifeste. */
  totalFiles: number;
  folderName: string;
  /** Une reprise est en cours de préparation (permission demandée). */
  busy: boolean;
  /** « Reprendre » / « Réessayer » : relance le moteur sur le même dossier, les fichiers complets sont sautés. */
  onResume: () => void;
  onChooseFolder: () => void;
  /**
   * Proposer de rechoisir le dossier même si la raison d'arrêt ne l'implique pas
   * (la reprise a échoué : accès refusé, dossier supprimé). Toujours proposé
   * quand l'accès a été perdu.
   */
  offerChooseFolder?: boolean;
}

export function ExportResultCard({
  result,
  totalFiles,
  folderName,
  busy,
  onResume,
  onChooseFolder,
  offerChooseFolder = false,
}: ExportResultCardProps) {
  const { reason, report } = result;
  const hasFailures = result.failures.length > 0 || report.failed > 0;
  const hasMissing = result.missing.length > 0 || report.missing > 0;

  // « Terminé » avec des échecs ou des manquants n'est pas un succès franc.
  const base = HEADLINES[reason];
  const headline: Headline =
    reason === "done" && (hasFailures || hasMissing) ? { ...base, icon: AlertTriangle, tone: "warning" } : base;
  const HeadlineIcon = headline.icon;

  let resumeLabel: string | null = null;
  if (reason === "done") {
    if (hasFailures) resumeLabel = "Réessayer les fichiers en échec";
  } else if (reason !== "link_gone") {
    resumeLabel = "Reprendre";
  }
  const showChooseFolder = reason !== "link_gone" && (reason === "permission_lost" || offerChooseFolder);

  const rows: Array<{ label: string; value: string }> = [
    { label: "Fichiers enregistrés", value: `${formatCount(report.files)} / ${formatCount(totalFiles)}` },
  ];
  if (report.skipped > 0) rows.push({ label: "Déjà présents, non retéléchargés", value: formatCount(report.skipped) });
  if (report.bytes > 0) rows.push({ label: "Téléchargé pendant cette session", value: formatMaxSize(report.bytes) });
  if (report.failed > 0) rows.push({ label: "En échec", value: formatCount(report.failed) });
  if (report.missing > 0) rows.push({ label: "Introuvables", value: formatCount(report.missing) });

  return (
    <Card className="space-y-4">
      <div className="flex items-start gap-3" role="status">
        <span
          className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted ${TONE_ICON_CLASS[headline.tone]}`}
        >
          <HeadlineIcon size={18} />
        </span>
        <div className="min-w-0 space-y-1">
          <h2 className="text-base font-semibold leading-snug text-foreground">{headline.title}</h2>
          <p className="text-[13px] leading-relaxed text-muted-foreground">{describe(result, folderName)}</p>
        </div>
      </div>

      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 rounded-md border border-border bg-muted px-3 py-2.5 text-[13px]">
        {rows.map((row) => (
          <Fragment key={row.label}>
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="text-right font-medium tabular-nums text-foreground">{row.value}</dd>
          </Fragment>
        ))}
      </dl>

      {result.failures.length > 0 && (
        <Alert
          variant="warning"
          title={plural(
            result.failures.length,
            "fichier n'a pas pu être enregistré",
            "fichiers n'ont pas pu être enregistrés",
          )}
        >
          <IssueList
            items={result.failures.map((failure) => ({
              key: failure.ref,
              label: shortPath(failure.path),
              title: fullPath(failure.path),
              detail: failure.error,
            }))}
          />
        </Alert>
      )}

      {result.missing.length > 0 && (
        <Alert
          variant="info"
          title={plural(result.missing.length, "fichier est devenu introuvable", "fichiers sont devenus introuvables")}
        >
          Ces fichiers ne sont plus disponibles : prévins ton interlocuteur.
          <IssueList
            items={result.missing.map((file) => ({
              key: file.ref,
              label: shortPath(file.path),
              title: fullPath(file.path),
            }))}
          />
        </Alert>
      )}

      {(resumeLabel || showChooseFolder) && (
        <div className="flex flex-col gap-2 sm:flex-row">
          {resumeLabel && (
            <Button icon={RotateCcw} loading={busy} onClick={onResume}>
              {resumeLabel}
            </Button>
          )}
          {showChooseFolder && (
            <Button variant="outline" icon={FolderDown} disabled={busy} onClick={onChooseFolder}>
              Choisir le dossier à nouveau
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
