/**
 * POST /api/webhooks/runpod/captions
 *
 * Reçoit la callback RunPod quand un job captions termine.
 * Met à jour CaptionJob et nettoie la vidéo source en R2.
 * Sécurité : voir verifyAndParseRunpodWebhook (RUNPOD_WEBHOOK_SECRET).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getR2PublicUrl, isR2PublicUrl } from "@/lib/r2";
import { releaseJobSource } from "@/lib/upload/releaseJobSource";
import { verifyAndParseRunpodWebhook } from "@/lib/webhooks/runpod";
import { notifyUser } from "@/lib/sseStore";
import { onCaptionsCompleted } from "@/lib/services/slot/pipelineHooks";

type CaptionOutput = {
  video_url?: string;
  output_key?: string;
  error?: string;
  caption_job_id?: string;
};

export async function POST(req: NextRequest) {
  // Security-auditor Critical-1 — auth HMAC body-signed.
  const parsed = await verifyAndParseRunpodWebhook<CaptionOutput>(req);
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
    // Garde origin : voir webhook/renders pour le rationale.
    const submittedUrl = output.video_url;
    let videoUrl: string | null = null;
    if (submittedUrl && isR2PublicUrl(submittedUrl)) {
      videoUrl = submittedUrl;
    } else if (outputKey) {
      videoUrl = getR2PublicUrl(outputKey);
      if (submittedUrl) {
        console.warn(
          `[webhook/captions] job=${job.id} rejected non-R2 video_url=${submittedUrl} — using output_key fallback`,
        );
      }
    }

    await prisma.captionJob.update({
      where: { id: job.id },
      data: { status: "COMPLETED", outputUrl: videoUrl ?? null },
    });

    // Correctif perte de données : ce webhook nullait `inputKey` et supprimait
    // l'objet R2 SANS CONDITION. Or avec l'option « utiliser la vidéo du slot »,
    // `inputKey` vaut PublicationVersion.r2Key ou la clé du render (cf.
    // resolveSlotSourceVideo dans api/render/captions/route.ts) — l'incrustation
    // de sous-titres effaçait donc le montage du monteur ou la vidéo du render,
    // en laissant la ligne DB pointer vers un objet disparu.
    // `releaseJobSource` ne supprime que les clés sous "inputs/captions/", soit
    // les vidéos réellement uploadées pour ce job.
    await releaseJobSource(prisma, "caption", job);

    notifyUser(job.userId, { jobType: "captions", jobId: job.id, status: "COMPLETED", videoUrl: videoUrl ?? null });
    console.info(`[webhook/captions] job=${job.id} done, videoUrl=${videoUrl}`);

    // Parité avec le pipeline local : log activity + auto-transition pipeline.
    // Helper unique pour éviter le drift entre webhook RunPod et exécution locale.
    await onCaptionsCompleted(job.id);
  } else {
    const errorMsg = output?.error ?? error ?? `RunPod status: ${status}`;

    await prisma.captionJob.update({
      where: { id: job.id },
      data: { status: "FAILED", errorMsg },
    });

    // Même garde qu'en branche COMPLETED : ne jamais supprimer une source qui
    // appartient à un render ou à une version montée.
    await releaseJobSource(prisma, "caption", job);

    notifyUser(job.userId, { jobType: "captions", jobId: job.id, status: "FAILED", errorMsg });
    console.error(`[webhook/captions] job=${job.id} failed: ${errorMsg}`);
  }

  return NextResponse.json({ ok: true });
}
