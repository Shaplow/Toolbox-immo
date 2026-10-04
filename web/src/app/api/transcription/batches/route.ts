/**
 * GET /api/transcription/batches?cursor=<jobId>
 *
 * Données de la page /transcriptions : une page de jobs de l'utilisateur,
 * complétée des jobs actifs et des lots coupés par la limite (cf.
 * lib/services/transcription/workspace.ts). Le client regroupe par lot avec
 * `groupJobsIntoBatches`.
 *
 * Réponse : { jobs: TranscriptionJobSummary[], nextCursor: string | null }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTranscriptionUser } from "@/lib/services/transcription/batchAccess";
import { listTranscriptionWorkspace } from "@/lib/services/transcription/workspace";

export async function GET(req: NextRequest) {
  const auth = await requireTranscriptionUser();
  if (auth.response) return auth.response;

  const cursor = new URL(req.url).searchParams.get("cursor");
  const page = await listTranscriptionWorkspace(auth.ctx.effectiveUser.id, { cursor });
  return NextResponse.json(page);
}
