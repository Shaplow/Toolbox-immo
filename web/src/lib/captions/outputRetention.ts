/**
 * outputRetention — quand la vidéo d'un sous-titrage de l'Atelier peut-elle partir ?
 *
 * ## Le problème résolu
 *
 * L'outil « Sous-titres » de l'Atelier produit une vidéo (~70 Mo) par génération,
 * stockée sur R2 sous `outputs/captions/<userId>/<ts>/{full|preview}.mp4`. Rien ne la
 * supprimait : 970 fichiers et 68 Go au 06/10/2026, presque tous introuvables dans
 * l'app (la file de la page de génération vit en mémoire, « Mes générations »
 * n'affiche que les 50 derniers sous-titrages).
 *
 * Règle : la vidéo est supprimée après 60 jours sans activité. L'activité est la
 * génération (`createdAt`) ou un téléchargement passé par l'app (`lastAccessedAt`,
 * posé par GET /api/render/captions/[id]/download). La ligne reste en historique
 * (« Expirée ») et ses sous-titres (`srtContent`) permettent de relancer la génération.
 *
 * ## Ce qui n'est JAMAIS purgé
 *
 * - un job lié à une publication (`slotId`) ou sous-titre actif d'une publication
 *   (`activeForSlot`) ;
 * - un job du pipeline auto (`srtFilename` « auto… », clé `…/auto.mp4`) : sous-titres
 *   des générations de templates, et anciens jobs de publications créés avant le
 *   30/05/2026 avec un `slotId` vide (cf. api/admin/jobs/backfill-caption-slot-ids) ;
 * - toute clé qui n'a pas la forme exacte d'une vidéo de l'Atelier.
 *
 * Module pur, importable côté client. Le traitement (écritures gardées, R2) vit dans
 * lib/services/captions/expireOutputs.ts.
 */

import type { Prisma } from "@prisma/client";
import { shortDateFr } from "@/lib/date/formatFr";

export const CAPTION_OUTPUT_RETENTION_DAYS = 60;
export const CAPTION_OUTPUT_RETENTION_MS = CAPTION_OUTPUT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** Préfixe R2 des vidéos produites par un sous-titrage. */
export const CAPTION_OUTPUT_PREFIX = "outputs/captions/";

/**
 * Clé d'une vidéo produite par l'Atelier : rendu complet ou aperçu 6 s, jamais
 * `auto.mp4` (pipeline auto). Le segment utilisateur est optionnel : les jobs
 * antérieurs au 20/04/2026 écrivaient `outputs/captions/<ts>/full.mp4`. Toute autre
 * forme est refusée, même si la ligne passe les filtres SQL.
 */
export const ATELIER_OUTPUT_KEY_RE = /^outputs\/captions\/(?:[^/]+\/)?\d+\/(full|preview)\.mp4$/;

/**
 * Nom de sous-titres posé par le pipeline auto (`auto-<txId>.json`,
 * `auto-transcription-<txId>.json`), même forme que api/admin/jobs/backfill-caption-slot-ids.
 * Un fichier importé par l'utilisateur (« automne.srt ») n'en est pas un.
 */
const AUTO_PIPELINE_SRT_RE = /^auto(?:-transcription)?-[a-z0-9]+\.json$/i;

/** Statuts terminaux : un job en cours n'est jamais purgé. */
export const PURGEABLE_STATUSES: readonly string[] = ["COMPLETED", "FAILED"];

export type RetentionJob = {
  status: string;
  slotId: string | null;
  /** Relation inverse de PublicationSlot.activeCaptionJobId (null si aucune). */
  activeForSlot: { id: string } | null;
  srtFilename: string | null;
  outputKey: string | null;
  outputExpiredAt: Date | null;
  lastAccessedAt: Date | null;
  createdAt: Date;
};

/** Dernière activité : téléchargement via l'app, sinon génération. */
export function captionActivityDate(job: Pick<RetentionJob, "lastAccessedAt" | "createdAt">): Date {
  return job.lastAccessedAt ?? job.createdAt;
}

/** Date à partir de laquelle la vidéo peut être supprimée, sans nouvelle activité. */
export function captionOutputAvailableUntil(job: Pick<RetentionJob, "lastAccessedAt" | "createdAt">): Date {
  return new Date(captionActivityDate(job).getTime() + CAPTION_OUTPUT_RETENTION_MS);
}

/** Toute activité antérieure à cette date rend la vidéo supprimable à `now`. */
export function captionRetentionCutoff(now: Date): Date {
  return new Date(now.getTime() - CAPTION_OUTPUT_RETENTION_MS);
}

/** Sous-titres posés par le pipeline auto, pas par l'outil de l'Atelier. */
function isAutoPipelineJob(job: Pick<RetentionJob, "srtFilename" | "outputKey">): boolean {
  return AUTO_PIPELINE_SRT_RE.test(job.srtFilename ?? "") || (job.outputKey ?? "").endsWith("/auto.mp4");
}

/** Sous-titrage de l'Atelier : hors publication et hors pipeline auto. */
export function isAtelierCaptionJob(
  job: Pick<RetentionJob, "slotId" | "activeForSlot" | "srtFilename" | "outputKey">,
): boolean {
  return !job.slotId && !job.activeForSlot && !isAutoPipelineJob(job);
}

/** Vidéo soumise à la rétention : sous-titrage de l'Atelier dont la clé R2 est reconnue. */
export function isSubjectToRetention(
  job: Pick<RetentionJob, "slotId" | "activeForSlot" | "srtFilename" | "outputKey">,
): boolean {
  return isAtelierCaptionJob(job) && !!job.outputKey && ATELIER_OUTPUT_KEY_RE.test(job.outputKey);
}

/**
 * La vidéo de ce job doit-elle être supprimée à `now` ? Doublon JS des filtres de
 * `purgeCandidateWhere`, appliqué à chaque ligne avant toute suppression.
 */
export function isPurgeCandidate(job: RetentionJob, now: Date): boolean {
  if (!PURGEABLE_STATUSES.includes(job.status)) return false;
  if (job.outputExpiredAt) return false;
  if (!isSubjectToRetention(job)) return false;
  return captionActivityDate(job).getTime() < captionRetentionCutoff(now).getTime();
}

/** « full » (rendu complet) ou « preview » (aperçu 6 s), d'après la clé. */
export function captionOutputKind(key: string | null): "full" | "preview" | null {
  const match = key ? ATELIER_OUTPUT_KEY_RE.exec(key) : null;
  return match ? (match[1] as "full" | "preview") : null;
}

/** Aucune activité depuis `cutoff` (téléchargement prioritaire, sinon génération). */
function inactiveSince(cutoff: Date): Prisma.CaptionJobWhereInput {
  return { OR: [{ lastAccessedAt: null, createdAt: { lt: cutoff } }, { lastAccessedAt: { lt: cutoff } }] };
}

/** Candidats à la purge (lecture). Chaque ligne repasse par `isPurgeCandidate`. */
export function purgeCandidateWhere(cutoff: Date): Prisma.CaptionJobWhereInput {
  return {
    status: { in: [...PURGEABLE_STATUSES] },
    outputExpiredAt: null,
    slotId: null,
    activeForSlot: { is: null },
    outputKey: { startsWith: CAPTION_OUTPUT_PREFIX },
    NOT: [{ outputKey: { endsWith: "/auto.mp4" } }],
    AND: [
      // Plus large que AUTO_PIPELINE_SRT_RE (« auto-…json »), donc plus prudent. En SQL, NOT
      // exclut aussi les NULL : la branche explicite garde les jobs sans nom de fichier.
      {
        OR: [
          { srtFilename: null },
          {
            NOT: {
              AND: [
                { srtFilename: { startsWith: "auto-", mode: "insensitive" } },
                { srtFilename: { endsWith: ".json", mode: "insensitive" } },
              ],
            },
          },
        ],
      },
      inactiveSince(cutoff),
    ],
  };
}

/**
 * Garde de la réclamation (écriture). Uniquement des colonnes du job, pour que Prisma
 * émette un seul UPDATE … WHERE atomique. La règle d'âge y est re-vérifiée : un
 * téléchargement arrivé entre la lecture et l'écriture fait échouer la réclamation,
 * et la vidéo reste. `activeForSlot` n'y figure pas : un job ne devient actif que
 * pour le slot auquel il est déjà lié, et `slotId: null` l'exclut.
 */
export function claimGuardWhere(id: string, cutoff: Date): Prisma.CaptionJobWhereInput {
  return {
    id,
    status: { in: [...PURGEABLE_STATUSES] },
    outputExpiredAt: null,
    slotId: null,
    AND: [inactiveSince(cutoff)],
  };
}

const DAYS = CAPTION_OUTPUT_RETENTION_DAYS;

export const CAPTION_RETENTION_COPY = {
  notice: `Tes vidéos sous-titrées sont gardées ${DAYS} jours après leur génération ou ton dernier téléchargement depuis l'app.`,
  availableUntil: (date: Date | string) =>
    `Disponible au moins jusqu'au ${shortDateFr(date)} — chaque téléchargement depuis l'app la garde ${DAYS} jours à partir de ce jour-là.`,
  expiredBadge: "Expirée",
  /** Ligne visible sous le titre d'une génération expirée. */
  expiredShort: `Vidéo supprimée après ${DAYS} jours sans téléchargement`,
  expiredTooltip: `Vidéo supprimée après ${DAYS} jours sans téléchargement. Tes sous-titres sont gardés : relance la génération en renvoyant ta vidéo d'origine.`,
  expiredError: `Cette vidéo a été supprimée après ${DAYS} jours sans téléchargement. Relance la génération en renvoyant ta vidéo d'origine.`,
} as const;
