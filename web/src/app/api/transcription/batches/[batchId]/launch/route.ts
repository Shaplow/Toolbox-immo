/**
 * POST /api/transcription/batches/[batchId]/launch
 *
 * Lance les vidéos prêtes du lot (QUEUED avec upload confirmé), ou le
 * sous-ensemble `jobIds`. Chaque job est vérifié puis claimé
 * (claimTranscriptionForSubmit) ; les jobs claimés partent ensuite vers RunPod
 * EN FOND, en Serverless (cf. launchTranscriptionJobs). La réponse n'attend que
 * les claims : quelques secondes, même pour 50 vidéos.
 *
 * Corps : { jobIds?: string[] }
 * Réponse : {
 *   results: { jobId, ok, code?, error? }[],
 *   started: number,
 *   failed: number,
 * }
 * 409 NOTHING_TO_LAUNCH si aucune vidéo n'est prête.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  batchNotFound,
  parseBatchIdParam,
  requireTranscriptionUser,
} from "@/lib/services/transcription/batchAccess";
import { launchTranscriptionJobs } from "@/lib/services/transcription/submitTranscription";

/** Garde-fou : un lot dépasse rarement quelques dizaines de vidéos. */
const MAX_BATCH_LAUNCH = 200;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const auth = await requireTranscriptionUser();
  if (auth.response) return auth.response;

  const batchId = parseBatchIdParam((await params).batchId);
  if (!batchId) return batchNotFound();

  const body = (await req.json().catch(() => ({}))) as { jobIds?: unknown };
  let jobIds: string[] | null = null;
  if (body.jobIds !== undefined) {
    if (
      !Array.isArray(body.jobIds) ||
      body.jobIds.length > MAX_BATCH_LAUNCH ||
      !body.jobIds.every((id): id is string => typeof id === "string" && id.length > 0)
    ) {
      return NextResponse.json({ error: "Champ 'jobIds' invalide" }, { status: 400 });
    }
    jobIds = body.jobIds;
  }

  const jobs = await prisma.transcriptionJob.findMany({
    where: {
      userId: auth.ctx.effectiveUser.id,
      batchId,
      status: "QUEUED",
      uploadedAt: { not: null },
      ...(jobIds ? { id: { in: jobIds } } : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: MAX_BATCH_LAUNCH,
  });

  if (jobs.length === 0) {
    // Lot inconnu (ou d'un autre utilisateur : même réponse, anti-énumération).
    const owned = await prisma.transcriptionJob.count({
      where: { userId: auth.ctx.effectiveUser.id, batchId },
    });
    if (owned === 0) return batchNotFound();
    return NextResponse.json(
      { error: "Aucune vidéo prête à lancer dans ce lot.", code: "NOTHING_TO_LAUNCH", results: [] },
      { status: 409 }
    );
  }

  const results = await launchTranscriptionJobs(jobs);
  const started = results.filter((result) => result.ok).length;

  return NextResponse.json({ results, started, failed: results.length - started });
}
