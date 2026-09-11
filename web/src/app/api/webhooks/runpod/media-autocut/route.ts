import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyAndParseRunpodWebhook } from "@/lib/webhooks/runpod";
import { notifyAll } from "@/lib/sseStore";
import { type MediaAutocutBatchOutput } from "@/lib/mediaAutocut";
import { applyAutocutBatchResults, failAutocutBatch } from "@/lib/mediaAutocutServer";

/**
 * POST /api/webhooks/runpod/media-autocut
 *
 * Reçoit la callback RunPod quand un job media_autocut_batch termine.
 * Résout chaque MediaAutocutJob individuellement depuis le tableau de résultats.
 * Sécurité : voir verifyAndParseRunpodWebhook (RUNPOD_WEBHOOK_SECRET).
 *
 * La logique métier (mise en échec, application des résultats) vit dans
 * @/lib/mediaAutocut : la réconciliation périodique la rejoue à l'identique
 * quand un webhook se perd.
 */
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
  // Le vrai message part sur le batch ET sur chacun de ses jobs : avant, les jobs
  // recevaient la constante « Échec global du job RunPod » et l'admin n'avait
  // aucun moyen de savoir ce qui s'était réellement passé.
  if (status !== "COMPLETED" || !output?.results) {
    const raw = output?.error ?? error ?? `RunPod status: ${status}`;
    console.error(`[webhook/media-autocut] batch=${batch.id} failed: ${raw}`);
    await failAutocutBatch(batch.id, raw);
    return NextResponse.json({ ok: true });
  }

  // ── Traiter les résultats individuels ────────────────────────────────────
  try {
    const outcome = await applyAutocutBatchResults(batch.id, output.results);

    // SSE émis après commit garanti (bug-hunter #10). notifyAll broadcast car le
    // modèle ne tracke pas l'admin déclencheur.
    notifyAll({
      jobType: "media-autocut",
      jobId: batch.id,
      status: outcome.batchStatus.toUpperCase(),
      doneCount: outcome.doneCount,
      failCount: outcome.failCount,
    });
  } catch (txErr) {
    console.error(`[webhook/media-autocut] transaction failed for batch=${batch.id}:`, txErr);
    // Libérer les jobs bloqués en pending/processing pour permettre une re-soumission
    await failAutocutBatch(batch.id, txErr, { prefix: "Traitement des résultats" }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
