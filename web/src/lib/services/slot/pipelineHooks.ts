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
import { autoPromoteIfNoActive, markJobsStaleForSlot } from "@/lib/publications/jobLifecycle";

/**
 * À appeler juste après qu'un Render passe à status="DONE".
 * No-op si le render n'est pas rattaché à un PublicationSlot.
 *
 * C'est le point de BASCULE d'un re-render : le rendu qui vient d'aboutir
 * devient le rendu courant du slot, et toute la chaîne aval calée sur le rendu
 * précédent (sous-titres, transcription, cover, description) est marquée
 * périmée. Promouvoir ici et pas au lancement est délibéré — pendant le rendu,
 * et si celui-ci échoue, la fiche continue de servir la vidéo précédente.
 */
export async function onRenderCompleted(renderId: string): Promise<void> {
  try {
    const render = await prisma.render.findUnique({
      where: { id: renderId },
      select: { publicationSlotId: true, videoUrl: true },
    });
    if (!render?.publicationSlotId) return;
    const slotId = render.publicationSlotId;

    const slot = await prisma.publicationSlot.findUnique({
      where: { id: slotId },
      select: { currentRenderId: true },
    });
    const previousRenderId = slot?.currentRenderId ?? null;
    const replacesPreviousRender = previousRenderId !== null && previousRenderId !== renderId;

    // Bascule + invalidation atomiques : le slot ne doit jamais pointer un
    // nouveau rendu tout en gardant des sous-titres réputés frais issus de
    // l'ancien (getSlotFinalVideoUrl fait primer la vidéo sous-titrée).
    await prisma.$transaction(async (tx) => {
      if (previousRenderId !== renderId) {
        await tx.publicationSlot.update({
          where: { id: slotId },
          data: { currentRenderId: renderId },
        });
      }
      if (replacesPreviousRender) {
        await markJobsStaleForSlot(tx, slotId, "render_replaced");
      }
    });

    await logActivity(prisma, {
      slotId,
      actorId: null,
      type: "RENDER_COMPLETED",
      payload: {
        renderId,
        videoUrl: render.videoUrl ?? null,
        ...(replacesPreviousRender ? { replacedRenderId: previousRenderId } : {}),
      },
    });

    await applyAutoTransitionFromPipeline(
      prisma,
      slotId,
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
