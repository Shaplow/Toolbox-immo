/**
 * Hooks post-completion pour les pipelines render & captions.
 *
 * Centralise les actions à effectuer quand un job atteint son état terminal
 * (DONE pour Render, COMPLETED pour CaptionJob) côté slot :
 *  1. logActivity (RENDER_COMPLETED / CAPTIONS_COMPLETED)
 *  2. applyAutoTransitionFromPipeline (PLANNED → READY_FOR_CM via auto-transition)
 *
 * Appelé depuis les deux côtés du pipeline :
 *  - Webhook RunPod (`/api/webhooks/runpod/{renders,captions}`)
 *  - Exécution locale (`generateRender`, `/api/render/captions`)
 *
 * Sans cette parité, un rendu local DONE ne transitionnait pas le slot
 * et ne loggait pas l'activité — le rattrapage opportuniste
 * `syncSlotsPipelineStatuses` couvrait fonctionnellement mais perdait la
 * trace audit + délai d'affichage côté UI.
 *
 * Best-effort : tout throw est logué et ignoré pour ne jamais faire échouer
 * le pipeline parent.
 */

import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/services/slot/activity";
import { applyAutoTransitionFromPipeline } from "@/lib/services/slot/transitions";
import { autoPromoteIfNoActive } from "@/lib/publications/jobLifecycle";

/**
 * À appeler juste après qu'un Render passe à status="DONE".
 * No-op si le render n'est pas rattaché à un PublicationSlot.
 */
export async function onRenderCompleted(renderId: string): Promise<void> {
  try {
    const render = await prisma.render.findUnique({
      where: { id: renderId },
      select: { publicationSlotId: true, videoUrl: true },
    });
    if (!render?.publicationSlotId) return;

    await logActivity(prisma, {
      slotId: render.publicationSlotId,
      actorId: null,
      type: "RENDER_COMPLETED",
      payload: { renderId, videoUrl: render.videoUrl ?? null },
    });

    await applyAutoTransitionFromPipeline(
      prisma,
      render.publicationSlotId,
      "RENDER_COMPLETED",
    );
  } catch (err) {
    console.error(`[onRenderCompleted] hook failed for render=${renderId}:`, err);
  }
}

/**
 * À appeler juste après qu'un CaptionJob passe à status="COMPLETED".
 * No-op si le job n'est pas rattaché à un PublicationSlot.
 */
export async function onCaptionsCompleted(captionJobId: string): Promise<void> {
  try {
    const job = await prisma.captionJob.findUnique({
      where: { id: captionJobId },
      select: { slotId: true, outputUrl: true },
    });
    if (!job?.slotId) return;

    // Auto-promote en tête : sans ça, slot.activeCaptionJobId reste null après
    // un job COMPLETED via pipeline auto, alors que l'UI affiche bien le job
    // via le fallback resolveActiveCaptionJob → divergence avec les gardes
    // backend qui lisent activeCaptionJobId strict (ex. envoi validation client).
    await autoPromoteIfNoActive(prisma, job.slotId, "caption", captionJobId);

    await logActivity(prisma, {
      slotId: job.slotId,
      actorId: null,
      type: "CAPTIONS_COMPLETED",
      payload: { captionJobId, videoUrl: job.outputUrl ?? null },
    });

    await applyAutoTransitionFromPipeline(
      prisma,
      job.slotId,
      "CAPTIONS_COMPLETED",
    );
  } catch (err) {
    console.error(`[onCaptionsCompleted] hook failed for caption=${captionJobId}:`, err);
  }
}
