import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyAndParseRunpodWebhook } from "@/lib/webhooks/runpod";
import { notifyAll } from "@/lib/sseStore";

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
  // Security-auditor Critical-1 — auth HMAC body-signed.
  const parsed = await verifyAndParseRunpodWebhook<MediaAutocutBatchOutput>(req);
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

    // Fix bug audit 2026-05-30 (M2) : SSE notify (broadcast — pas d'userId
    // trackable sur le batch). L'admin connecté voit le batch passer FAILED.
    notifyAll({ jobType: "media-autocut", jobId: batch.id, status: "FAILED", errorMsg });

    return NextResponse.json({ ok: true });
  }

  // ── Traiter les résultats individuels ────────────────────────────────────
  const results = output.results;

  // Utiliser updateMany au lieu de update pour éviter P2025 si un job a été supprimé
  // (ex. asset supprimé en cascade pendant le processing).
  // Les compteurs sont déclarés dans la callback pour être retry-safe.
  // Bug-hunter #10 (2026-06-01) : notifyAll déplacée hors transaction.
  // Avant : SSE était émis dans le callback `$transaction` avant le commit
  // → si rollback, le client recevait un done erroné ; si replica lag, polling
  // immédiat post-SSE renvoyait l'ancien status. Maintenant les variables
  // (batchStatus, doneCount, failCount) sont remontées et l'event part après await.
  try {
    const txResult = await prisma.$transaction(async (tx) => {
      let doneCount = 0;
      let failCount = 0;

      for (const result of results) {
        if (!result.job_id) continue;

        if (result.error) {
          const r = await tx.mediaAutocutJob.updateMany({
            where: { id: result.job_id },
            data: {
              status: "failed",
              errorMsg: result.error.slice(0, 500),
            },
          });
          if (r.count > 0) failCount++;
        } else {
          const r = await tx.mediaAutocutJob.updateMany({
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
          if (r.count > 0) doneCount++;
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

      console.info(
        `[webhook/media-autocut] batch=${batch!.id} done=${doneCount} failed=${failCount}`
      );

      return { batchStatus, doneCount, failCount };
    });

    // SSE émis après commit garanti. notifyAll broadcast car le modèle ne
    // tracke pas l'admin déclencheur.
    notifyAll({
      jobType: "media-autocut",
      jobId: batch.id,
      status: txResult.batchStatus.toUpperCase(),
      doneCount: txResult.doneCount,
      failCount: txResult.failCount,
    });
  } catch (txErr) {
    console.error(`[webhook/media-autocut] transaction failed for batch=${batch.id}:`, txErr);
    // Libérer les jobs bloqués en "processing" pour permettre une re-soumission
    await prisma.mediaAutocutBatch.update({
      where: { id: batch.id },
      data: { status: "failed", errorMsg: String(txErr).slice(0, 500) },
    }).catch(() => {});
    await prisma.mediaAutocutJob.updateMany({
      where: { batchId: batch.id, status: "processing" },
      data: { status: "failed", errorMsg: "Erreur lors du traitement des résultats" },
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
