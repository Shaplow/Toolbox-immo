/**
 * PATCH /api/transcription/batches/[batchId]
 *
 * Règle « Identifier les intervenants » (diarisation) sur toutes les vidéos du
 * lot qui ne sont pas encore lancées (QUEUED — prêtes ou encore en upload).
 * Les jobs lancés ou terminés ne changent pas.
 *
 * Corps : { enable_diarization: boolean }
 * Réponse : { updated: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  batchNotFound,
  parseBatchIdParam,
  requireTranscriptionUser,
} from "@/lib/services/transcription/batchAccess";
import { DIARIZATION_UNAVAILABLE_MESSAGE } from "@/lib/services/transcription/submitTranscription";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const auth = await requireTranscriptionUser();
  if (auth.response) return auth.response;

  const batchId = parseBatchIdParam((await params).batchId);
  if (!batchId) return batchNotFound();

  const body = (await req.json().catch(() => null)) as { enable_diarization?: unknown } | null;
  if (typeof body?.enable_diarization !== "boolean") {
    return NextResponse.json({ error: "Champ 'enable_diarization' (booléen) requis" }, { status: 400 });
  }
  const enableDiarization = body.enable_diarization;
  if (enableDiarization && !process.env.HF_TOKEN) {
    return NextResponse.json({ error: DIARIZATION_UNAVAILABLE_MESSAGE }, { status: 503 });
  }

  const result = await prisma.transcriptionJob.updateMany({
    where: { userId: auth.ctx.effectiveUser.id, batchId, status: "QUEUED" },
    data: { enableDiarization },
  });

  return NextResponse.json({ updated: result.count });
}
