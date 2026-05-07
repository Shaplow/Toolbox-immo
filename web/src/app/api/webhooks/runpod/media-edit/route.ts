import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyRunpodWebhook, parseRunpodWebhookBody } from "@/lib/webhooks/runpod";

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
};

export async function POST(req: NextRequest) {
  const authError = verifyRunpodWebhook(req);
  if (authError) return authError;

  const parsed = await parseRunpodWebhookBody<MediaEditOutput>(req);
  if (!parsed.ok) return parsed.response;

  const { id: runpodId, status, output, error } = parsed.body;

  const job = await prisma.mediaEditJob.findUnique({ where: { runpodId } });
  if (!job) {
    // Job inconnu — peut arriver si un webhook est rejoué après suppression. On répond 200.
    console.warn(`[webhook/media-edit] Unknown runpodId=${runpodId}`);
    return NextResponse.json({ ok: true });
  }

  if (job.status === "done" || job.status === "failed") {
    // Déjà traité (webhook rejoué) — idempotent
    return NextResponse.json({ ok: true });
  }

  if (status === "COMPLETED" && output && !output.error) {
    const newDuration = typeof output.duration === "number" ? output.duration : undefined;
    const newUrl = output.video_url ?? undefined;

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
