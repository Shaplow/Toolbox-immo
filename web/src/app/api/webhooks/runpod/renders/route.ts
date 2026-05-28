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
import { recordLibraryUsage, revertLibraryCursors } from "@/lib/recordLibraryUsage";
import { RENDER_STAGE } from "@/lib/renderer/renderWorkflow";
import { triggerAutoTranscriptionForRender } from "@/lib/triggerAutoTranscription";
import { triggerAutoCoverPackForRender } from "@/lib/coverAuto";
import { logActivity } from "@/lib/services/slot/activity";
import { applyAutoTransitionFromPipeline } from "@/lib/services/slot/transitions";

type RenderOutput = {
  video_url?: string;
  output_key?: string;
  error?: string;
  render_id?: string;
  /** Per-slot effective duration produit par le worker sequence (worker/render_sequence). */
  slot_durations?: Record<string, number>;
};

export async function POST(req: NextRequest) {
  const authError = verifyRunpodWebhook(req);
  if (authError) return authError;

  const parsed = await parseRunpodWebhookBody<RenderOutput>(req);
  if (!parsed.ok) return parsed.response;

  const { id: runpodJobId, status, output, error } = parsed.body;

  let render = await prisma.render.findFirst({
    where: { runpodJobId },
    include: { listing: { select: { userId: true } }, publicationSlot: { select: { id: true } } },
  });
  if (!render && output?.render_id) {
    render = await prisma.render.findFirst({
      where: { id: output.render_id },
      include: { listing: { select: { userId: true } }, publicationSlot: { select: { id: true } } },
    });
    if (render && !render.runpodJobId) {
      await prisma.render.update({ where: { id: render.id }, data: { runpodJobId } });
      render = { ...render, runpodJobId };
    }
  }
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
        ...(output.slot_durations && Object.keys(output.slot_durations).length > 0
          ? { slotDurations: JSON.stringify(output.slot_durations) }
          : {}),
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

    if (render.publicationSlot) {
      await logActivity(prisma, {
        slotId: render.publicationSlot.id,
        actorId: null,
        type: "RENDER_COMPLETED",
        payload: { renderId: render.id, videoUrl },
      });

      // Auto-transition pipeline : si auto_template + render DONE + (pas de captions
      // OU captions déjà COMPLETED) → READY_FOR_CM. Idempotent (no-op si déjà avancé).
      await applyAutoTransitionFromPipeline(
        prisma,
        render.publicationSlot.id,
        "RENDER_COMPLETED",
      );
    }

    // ── Pipeline sous-titres automatique ──────────────────────────────────
    // Non bloquant : les erreurs internes ne doivent pas faire échouer le webhook.
    if (outputKey) {
      void triggerAutoTranscriptionForRender(
        render.id,
        render.templateId,
        outputKey,
        userId,
      ).catch((err) =>
        console.error(`[webhook/renders] triggerAutoTranscription threw: ${String(err)}`),
      );
    }

    if (videoUrl) {
      void triggerAutoCoverPackForRender(
        render.id,
        render.templateId,
        videoUrl,
        userId,
      ).catch((err) =>
        console.error(`[webhook/renders] triggerAutoCoverPack threw: ${String(err)}`),
      );
    }
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
    void revertLibraryCursors(render.id);
    console.error(`[webhook/renders] render=${render.id} failed: ${errorMsg}`);
  }

  return NextResponse.json({ ok: true });
}
