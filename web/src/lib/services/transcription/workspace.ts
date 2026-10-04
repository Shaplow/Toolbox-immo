/**
 * workspace — données de la page /transcriptions, organisée en lots.
 *
 * Une page = les 100 jobs les plus récents, plus deux compléments :
 * - tous les jobs actifs (QUEUED / PROCESSING), même plus anciens : sans eux,
 *   un lot encore en attente échapperait à « Lancer » et au rafraîchissement ;
 * - les jobs manquants des lots coupés par la limite : un lot s'affiche
 *   toujours entier, sinon ses compteurs et son ZIP mentiraient.
 *
 * Partagé par le SSR de la page et GET /api/transcription/batches.
 */

import { prisma } from "@/lib/prisma";
import {
  TRANSCRIPTION_JOB_SUMMARY_SELECT,
  mergeJobs,
  toTranscriptionJobSummary,
  type TranscriptionJobSummary,
} from "@/lib/transcription/batches";

export const WORKSPACE_PAGE_SIZE = 100;

/** Garde-fou : au-delà, les jobs actifs plus anciens ne sont pas ajoutés. */
const MAX_ACTIVE_JOBS = 500;

export type TranscriptionWorkspacePage = {
  jobs: TranscriptionJobSummary[];
  /** Id du dernier job de la page, à repasser en `cursor` ; null en fin de liste. */
  nextCursor: string | null;
};

export async function listTranscriptionWorkspace(
  userId: string,
  opts: { cursor?: string | null } = {},
): Promise<TranscriptionWorkspacePage> {
  const page = await prisma.transcriptionJob.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: WORKSPACE_PAGE_SIZE,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: TRANSCRIPTION_JOB_SUMMARY_SELECT,
  });

  const active = opts.cursor
    ? []
    : await prisma.transcriptionJob.findMany({
        where: { userId, status: { in: ["QUEUED", "PROCESSING"] } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: MAX_ACTIVE_JOBS,
        select: TRANSCRIPTION_JOB_SUMMARY_SELECT,
      });

  const loaded = [...page, ...active];
  const batchIds = [...new Set(loaded.map((job) => job.batchId).filter((id): id is string => !!id))];
  const siblings = batchIds.length
    ? await prisma.transcriptionJob.findMany({
        where: { userId, batchId: { in: batchIds } },
        select: TRANSCRIPTION_JOB_SUMMARY_SELECT,
      })
    : [];

  const jobs = mergeJobs([], [...loaded, ...siblings].map(toTranscriptionJobSummary));
  const nextCursor = page.length === WORKSPACE_PAGE_SIZE ? page[page.length - 1].id : null;
  return { jobs, nextCursor };
}
