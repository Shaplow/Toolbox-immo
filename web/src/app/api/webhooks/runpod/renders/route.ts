/**
 * POST /api/webhooks/runpod/renders
 *
 * Reçoit la callback RunPod quand un job render_template termine.
 * Met à jour Render, enregistre l'usage bibliothèque, et pousse un event SSE.
 * Sécurité : voir verifyRunpodWebhook (RUNPOD_WEBHOOK_SECRET).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getR2PublicUrl } from "@/lib/r2";
import { verifyRunpodWebhook, parseRunpodWebhookBody } from "@/lib/webhooks/runpod";
import { notifyUser } from "@/lib/sseStore";
import { recordLibraryUsage } from "@/lib/recordLibraryUsage";
import { RENDER_STAGE } from "@/lib/renderer/renderWorkflow";

type RenderOutput = {
  video_url?: string;
  output_key?: string;
  error?: string;
};

export async function POST(req: NextRequest) {
  const authError = verifyRunpodWebhook(req);
  if (authError) return authError;

  const parsed = await parseRunpodWebhookBody<RenderOutput>(req);
  if (!parsed.ok) return parsed.response;

  const { id: runpodJobId, status, output, error } = parsed.body;

  const render = await prisma.render.findFirst({
    where: { runpodJobId },
    include: { listing: { select: { userId: true } } },
  });
  if (!render) {
    console.warn(`[webhook/renders] Unknown runpodJobId=${runpodJobId}`);
    return NextResponse.json({ ok: true });
  }

  // Idempotent — webhook peut être rejoué
  if (render.status === "DONE" || render.status === "ERROR") {
    return NextResponse.json({ ok: true });
  }

  const userId = render.listing.userId;

  if (status === "COMPLETED" && output && !output.error) {
    const outputKey = output.output_key ?? "";
    const videoUrl = output.video_url ?? (outputKey ? getR2PublicUrl(outputKey) : null);

    await prisma.render.update({
      where: { id: render.id },
      data: {
        status: "DONE",
        stage: RENDER_STAGE.DONE,
        statusDetail: "Vidéo RunPod terminée",
        progress: 1,
        videoUrl: videoUrl ?? undefined,
        finishedAt: new Date(),
        lastHeartbeatAt: new Date(),
      },
    });

    void recordLibraryUsage(render.id);

    notifyUser(userId, {
      jobType: "render",
      jobId: render.id,
      status: "DONE",
      videoUrl: videoUrl ?? null,
    });
    console.info(`[webhook/renders] render=${render.id} done, videoUrl=${videoUrl}`);
  } else {
    const errorMsg = output?.error ?? error ?? `RunPod status: ${status}`;

    await prisma.render.update({
      where: { id: render.id },
      data: {
        status: "ERROR",
        stage: RENDER_STAGE.ERROR,
        statusDetail: errorMsg,
        errorMsg,
        progress: 1,
        finishedAt: new Date(),
        lastHeartbeatAt: new Date(),
      },
    });

    notifyUser(userId, {
      jobType: "render",
      jobId: render.id,
      status: "ERROR",
      errorMsg,
    });
    console.error(`[webhook/renders] render=${render.id} failed: ${errorMsg}`);
  }

  return NextResponse.json({ ok: true });
}
