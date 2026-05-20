/**
 * POST /api/webhooks/runpod/captions
 *
 * Reçoit la callback RunPod quand un job captions termine.
 * Met à jour CaptionJob et nettoie la vidéo source en R2.
 * Sécurité : voir verifyRunpodWebhook (RUNPOD_WEBHOOK_SECRET).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getR2PublicUrl, deleteFromR2, r2Configured } from "@/lib/r2";
import { verifyRunpodWebhook, parseRunpodWebhookBody } from "@/lib/webhooks/runpod";
import { notifyUser } from "@/lib/sseStore";

type CaptionOutput = {
  video_url?: string;
  output_key?: string;
  error?: string;
  caption_job_id?: string;
};

export async function POST(req: NextRequest) {
  const authError = verifyRunpodWebhook(req);
  if (authError) return authError;

  const parsed = await parseRunpodWebhookBody<CaptionOutput>(req);
  if (!parsed.ok) return parsed.response;

  const { id: runpodJobId, status, output, error } = parsed.body;

  let job = await prisma.captionJob.findUnique({ where: { runpodJobId } });
  if (!job && output?.caption_job_id) {
    job = await prisma.captionJob.findUnique({ where: { id: output.caption_job_id } });
    if (job && !job.runpodJobId) {
      await prisma.captionJob.update({ where: { id: job.id }, data: { runpodJobId } });
      job = { ...job, runpodJobId };
    }
  }
  if (!job) {
    console.warn(`[webhook/captions] Unknown runpodJobId=${runpodJobId}`);
    return NextResponse.json({ ok: true });
  }

  // Idempotent — webhook peut être rejoué
  if (job.status === "COMPLETED" || job.status === "FAILED") {
    return NextResponse.json({ ok: true });
  }

  if (status === "COMPLETED" && output && !output.error) {
    const outputKey = output.output_key ?? job.outputKey ?? "";
    const videoUrl = output.video_url ?? (outputKey ? getR2PublicUrl(outputKey) : null);

    await prisma.captionJob.update({
      where: { id: job.id },
      data: { status: "COMPLETED", outputUrl: videoUrl ?? null, inputKey: null },
    });

    if (job.inputKey && r2Configured()) {
      deleteFromR2(job.inputKey).catch((err) =>
        console.warn(`[webhook/captions] R2 cleanup failed for key=${job.inputKey}:`, err)
      );
    }

    notifyUser(job.userId, { jobType: "captions", jobId: job.id, status: "COMPLETED", videoUrl: videoUrl ?? null });
    console.info(`[webhook/captions] job=${job.id} done, videoUrl=${videoUrl}`);
  } else {
    const errorMsg = output?.error ?? error ?? `RunPod status: ${status}`;

    await prisma.captionJob.update({
      where: { id: job.id },
      data: { status: "FAILED", errorMsg, inputKey: null },
    });

    if (job.inputKey && r2Configured()) {
      deleteFromR2(job.inputKey).catch((err) =>
        console.warn(`[webhook/captions] R2 cleanup failed for key=${job.inputKey}:`, err)
      );
    }

    notifyUser(job.userId, { jobType: "captions", jobId: job.id, status: "FAILED", errorMsg });
    console.error(`[webhook/captions] job=${job.id} failed: ${errorMsg}`);
  }

  return NextResponse.json({ ok: true });
}
