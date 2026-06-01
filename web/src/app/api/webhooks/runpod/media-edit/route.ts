import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyAndParseRunpodWebhook } from "@/lib/webhooks/runpod";
import { isR2PublicUrl } from "@/lib/r2";

/**
 * POST /api/webhooks/runpod/media-edit
 *
 * Reçoit la callback RunPod quand un job media_edit termine.
 * Sécurité : voir verifyRunpodWebhook (RUNPOD_WEBHOOK_SECRET).
 */

type MediaEditOutput = {
  duration?: number;
  r2_key?: string;
  video_url?: string;
  error?: string;
  /** Echoed back by the worker so the webhook can resolve the job even if runpodId
   * was not yet written to the DB (race: RunPod callback arrived before our
   * mediaEditJob.update({ runpodId }) completed). */
  job_id?: string;
};

export async function POST(req: NextRequest) {
  // Security-auditor Critical-1 — auth HMAC body-signed.
  const parsed = await verifyAndParseRunpodWebhook<MediaEditOutput>(req);
  if (!parsed.ok) return parsed.response;

  const { id: runpodId, status, output, error } = parsed.body;

  let job = await prisma.mediaEditJob.findUnique({ where: { runpodId } });

  if (!job && output?.job_id) {
    // Race condition fallback: RunPod called back before we finished writing runpodId to DB.
    // The worker echoes job_id in its output — use it to find the row and backfill runpodId.
    job = await prisma.mediaEditJob.findUnique({ where: { id: output.job_id } });
    if (job && !job.runpodId) {
      await prisma.mediaEditJob.update({ where: { id: job.id }, data: { runpodId } });
      job = { ...job, runpodId };
    }
  }

  if (!job) {
    // Truly unknown — webhook replayed after row was deleted. Respond 200 to stop retries.
    console.warn(`[webhook/media-edit] Unknown runpodId=${runpodId}`);
    return NextResponse.json({ ok: true });
  }

  if (job.status === "done" || job.status === "failed") {
    // Déjà traité (webhook rejoué) — idempotent
    return NextResponse.json({ ok: true });
  }

  if (status === "COMPLETED" && output && !output.error) {
    const newDuration = typeof output.duration === "number" ? output.duration : undefined;
    // Garde origin : MediaAsset.url est rendu directement dans des templates ;
    // un video_url externe → stored XSS si template encode mal, ou exfiltration
    // via fetch côté serveur. On rejette tout ce qui n'est pas notre R2 public.
    const newUrl = output.video_url && isR2PublicUrl(output.video_url)
      ? output.video_url
      : undefined;
    // Bug-hunter #7 — Si le worker renvoie un video_url non-R2 (worker mal configuré,
    // env R2_PUBLIC_URL absente, etc.), on doit FAIL le job. Sinon : asset.url
    // garde l'ancienne valeur (cache-bust trompeur) tandis qu'un nouvel objet
    // R2 a été créé par le worker et reste orphelin pour toujours.
    if (output.video_url && newUrl === undefined) {
      const errorMsg = `Output video_url non-R2 rejeté (sécurité) : ${output.video_url}`;
      console.error(`[webhook/media-edit] job=${job.id} ${errorMsg}`);
      await prisma.mediaEditJob.update({
        where: { id: job.id },
        data: { status: "failed", errorMsg },
      });
      return NextResponse.json({ ok: true });
    }

    await prisma.$transaction(async (tx) => {
      await tx.mediaEditJob.update({
        where: { id: job.id },
        data: { status: "done" },
      });

      if (newDuration !== undefined || newUrl !== undefined) {
        const assetUpdate: Record<string, unknown> = {};
        if (newDuration !== undefined) assetUpdate.duration = newDuration;
        // Cache-bust the URL by appending a version timestamp so browsers and
        // CDN don't serve the old file.
        if (newUrl !== undefined) {
          assetUpdate.url = `${newUrl.split("?")[0]}?v=${job.id}`;
        } else {
          // Fallback: bump the existing URL's version param
          const asset = await tx.mediaAsset.findUnique({
            where: { id: job.assetId },
            select: { url: true },
          });
          if (asset) {
            assetUpdate.url = `${asset.url.split("?")[0]}?v=${job.id}`;
          }
        }
        await tx.mediaAsset.update({
          where: { id: job.assetId },
          data: assetUpdate,
        });
      }
    });

    console.info(`[webhook/media-edit] job=${job.id} done, asset=${job.assetId}`);
  } else {
    const errorMsg =
      output?.error ?? error ?? `RunPod status: ${status}`;

    await prisma.mediaEditJob.update({
      where: { id: job.id },
      data: { status: "failed", errorMsg },
    });

    console.error(`[webhook/media-edit] job=${job.id} failed: ${errorMsg}`);
  }

  return NextResponse.json({ ok: true });
}
