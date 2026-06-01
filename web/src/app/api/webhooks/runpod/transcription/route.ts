/**
 * POST /api/webhooks/runpod/transcription
 *
 * Reçoit la callback RunPod quand un job transcription termine.
 * Met à jour TranscriptionJob et nettoie le fichier audio source en R2.
 * Sécurité : voir verifyRunpodWebhook (RUNPOD_WEBHOOK_SECRET).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deleteFromR2, r2Configured } from "@/lib/r2";
import { verifyAndParseRunpodWebhook } from "@/lib/webhooks/runpod";
import { notifyUser } from "@/lib/sseStore";
import { triggerAutoCaptionForTranscription } from "@/lib/triggerAutoCaptionFromTranscription";
import { triggerAutoDescriptionForTranscription } from "@/lib/triggerAutoDescriptionFromTranscription";

type TranscriptionOutput = {
  output_key?: string;
  segment_count?: number;
  duration?: number;
  language?: string;
  has_diarization?: boolean;
  error?: string;
  job_id?: string;
};

export async function POST(req: NextRequest) {
  // Security-auditor Critical-1 — auth HMAC body-signed.
  const parsed = await verifyAndParseRunpodWebhook<TranscriptionOutput>(req);
  if (!parsed.ok) return parsed.response;

  const { id: runpodJobId, status, output, error } = parsed.body;

  let job = await prisma.transcriptionJob.findUnique({ where: { runpodJobId } });
  if (!job && output?.job_id) {
    job = await prisma.transcriptionJob.findUnique({ where: { id: output.job_id } });
    if (job && !job.runpodJobId) {
      await prisma.transcriptionJob.update({ where: { id: job.id }, data: { runpodJobId } });
      job = { ...job, runpodJobId };
    }
  }
  if (!job) {
    console.warn(`[webhook/transcription] Unknown runpodJobId=${runpodJobId}`);
    return NextResponse.json({ ok: true });
  }

  // Idempotent — webhook peut être rejoué
  if (job.status === "COMPLETED" || job.status === "FAILED") {
    return NextResponse.json({ ok: true });
  }

  if (status === "COMPLETED" && output && !output.error) {
    // Pour les jobs auto-déclenchés (renderId OU publicationVersionId présent),
    // inputKey pointe vers une vidéo qu'on doit conserver (le render pour
    // auto_template, la version uploadée pour manual_rushes / external_upload).
    const isAutoPipeline = Boolean(job.renderId || job.publicationVersionId);

    await prisma.transcriptionJob.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED",
        outputJsonKey: output.output_key ?? job.outputJsonKey,
        segmentCount: output.segment_count ?? null,
        duration: output.duration ?? null,
        hasDiarization: output.has_diarization ?? false,
        // Conserver inputKey pour les jobs auto (render video) — null pour les jobs manuels
        ...(isAutoPipeline ? {} : { inputKey: null }),
      },
    });

    if (!isAutoPipeline && job.inputKey && r2Configured()) {
      deleteFromR2(job.inputKey).catch((err) =>
        console.warn(`[webhook/transcription] R2 cleanup failed for key=${job.inputKey}:`, err)
      );
    }

    notifyUser(job.userId, {
      jobType: "transcription",
      jobId: job.id,
      status: "COMPLETED",
      segmentCount: output.segment_count ?? null,
      duration: output.duration ?? null,
      hasDiarization: output.has_diarization ?? false,
    });
    console.info(`[webhook/transcription] job=${job.id} done`);

    // ── Pipeline sous-titres automatique ─────────────────────────────────
    // Captions auto : nécessite un template avec captionAutoConfig.enabled,
    // donc uniquement pour les transcriptions liées à un render (auto_template).
    // Pour les transcriptions liées à une PublicationVersion (manual_rushes),
    // le trigger return early de toute façon (no renderId). La CM peut
    // toujours lancer les captions manuellement via la fiche.
    if (job.renderId) {
      void triggerAutoCaptionForTranscription(job.id).catch((err) =>
        console.error(`[webhook/transcription] triggerAutoCaption threw: ${String(err)}`),
      );
    }

    // ── Pipeline description IA automatique ────────────────────────────────
    // Marche pour les deux paths : render-based ET version-based. Le trigger
    // résout le slot via render.publicationSlotId OU
    // publicationVersion.slotId selon ce qui est disponible (Phase 2.4).
    if (isAutoPipeline) {
      void triggerAutoDescriptionForTranscription(job.id).catch((err) =>
        console.error(`[webhook/transcription] triggerAutoDescription threw: ${String(err)}`),
      );
    }
  } else {
    const errorMsg = output?.error ?? error ?? `RunPod status: ${status}`;
    const isAutoPipeline = Boolean(job.renderId);

    await prisma.transcriptionJob.update({
      where: { id: job.id },
      data: { status: "FAILED", errorMsg, ...(isAutoPipeline ? {} : { inputKey: null }) },
    });

    // Ne pas supprimer le fichier R2 si c'est la vidéo d'un render auto
    if (!isAutoPipeline && job.inputKey && r2Configured()) {
      deleteFromR2(job.inputKey).catch((err) =>
        console.warn(`[webhook/transcription] R2 cleanup failed for key=${job.inputKey}:`, err)
      );
    }

    notifyUser(job.userId, { jobType: "transcription", jobId: job.id, status: "FAILED", errorMsg });
    console.error(`[webhook/transcription] job=${job.id} failed: ${errorMsg}`);
  }

  return NextResponse.json({ ok: true });
}
