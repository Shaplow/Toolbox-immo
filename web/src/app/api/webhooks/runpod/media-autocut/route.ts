import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyRunpodWebhook, parseRunpodWebhookBody } from "@/lib/webhooks/runpod";

/**
 * POST /api/webhooks/runpod/media-autocut
 *
 * Reçoit la callback RunPod quand un job media_autocut_batch termine.
 * Résout chaque MediaAutocutJob individuellement depuis le tableau de résultats.
 * Sécurité : voir verifyRunpodWebhook (RUNPOD_WEBHOOK_SECRET).
 */

type AutocutJobResult = {
  job_id: string;
  proposed_start?: number;
  proposed_end?: number;
  transcript_json?: string;
  language?: string;
  fallback?: boolean;
  error?: string;
};

type MediaAutocutBatchOutput = {
  batch_id?: string;
  results?: AutocutJobResult[];
  error?: string;
};

export async function POST(req: NextRequest) {
  const authError = verifyRunpodWebhook(req);
  if (authError) return authError;

  const parsed = await parseRunpodWebhookBody<MediaAutocutBatchOutput>(req);
  if (!parsed.ok) return parsed.response;

  const { id: runpodId, status, output, error } = parsed.body;

  // ── Trouver le batch via runpodId ────────────────────────────────────────
  let batch = await prisma.mediaAutocutBatch.findUnique({ where: { runpodId } });

  // Race condition fallback : le webhook est arrivé avant que runpodId soit écrit en DB.
  // Le worker echo batch_id dans output — on peut retrouver le batch et backfiller runpodId.
  if (!batch && output?.batch_id) {
    batch = await prisma.mediaAutocutBatch.findFirst({
      where: { id: output.batch_id },
    });
    if (batch && !batch.runpodId) {
      await prisma.mediaAutocutBatch.update({
        where: { id: batch.id },
        data: { runpodId },
      });
      batch = { ...batch, runpodId };
    }
  }

  if (!batch) {
    console.warn(`[webhook/media-autocut] Unknown runpodId=${runpodId}`);
    return NextResponse.json({ ok: true });
  }

  // Idempotence
  if (batch.status === "done" || batch.status === "partial" || batch.status === "failed") {
    return NextResponse.json({ ok: true });
  }

  // ── Échec global du job RunPod ───────────────────────────────────────────
  if (status !== "COMPLETED" || !output?.results) {
    const errorMsg = output?.error ?? error ?? `RunPod status: ${status}`;
    console.error(`[webhook/media-autocut] batch=${batch.id} failed: ${errorMsg}`);

    await prisma.$transaction(async (tx) => {
      await tx.mediaAutocutBatch.update({
        where: { id: batch!.id },
        data: { status: "failed", errorMsg },
      });
      await tx.mediaAutocutJob.updateMany({
        where: { batchId: batch!.id, status: "processing" },
        data: { status: "failed", errorMsg: "Échec global du job RunPod" },
      });
    });

    return NextResponse.json({ ok: true });
  }

  // ── Traiter les résultats individuels ────────────────────────────────────
  const results = output.results;
  let doneCount = 0;
  let failCount = 0;

  await prisma.$transaction(async (tx) => {
    for (const result of results) {
      if (!result.job_id) continue;

      if (result.error) {
        await tx.mediaAutocutJob.update({
          where: { id: result.job_id },
          data: {
            status: "failed",
            errorMsg: result.error.slice(0, 500),
          },
        });
        failCount++;
      } else {
        await tx.mediaAutocutJob.update({
          where: { id: result.job_id },
          data: {
            status: "done",
            reviewStatus: "pending_review",
            proposedStart: result.proposed_start ?? null,
            proposedEnd: result.proposed_end ?? null,
            transcriptJson: result.transcript_json ?? null,
            language: result.language ?? null,
            // Pré-remplir les confirmed avec les proposed pour simplifier la review
            confirmedStart: result.proposed_start ?? null,
            confirmedEnd: result.proposed_end ?? null,
          },
        });
        doneCount++;
      }
    }

    // Mettre à jour le batch
    const batchStatus =
      failCount === 0 ? "done" :
      doneCount === 0 ? "failed" :
      "partial";

    await tx.mediaAutocutBatch.update({
      where: { id: batch!.id },
      data: { status: batchStatus, doneCount, failCount },
    });
  });

  console.info(
    `[webhook/media-autocut] batch=${batch.id} done=${doneCount} failed=${failCount}`
  );

  return NextResponse.json({ ok: true });
}
