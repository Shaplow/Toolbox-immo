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
import { verifyRunpodWebhook, parseRunpodWebhookBody } from "@/lib/webhooks/runpod";
import { notifyUser } from "@/lib/sseStore";

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
  const authError = verifyRunpodWebhook(req);
  if (authError) return authError;

  const parsed = await parseRunpodWebhookBody<TranscriptionOutput>(req);
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
    await prisma.transcriptionJob.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED",
        outputJsonKey: output.output_key ?? job.outputJsonKey,
        segmentCount: output.segment_count ?? null,
        duration: output.duration ?? null,
        hasDiarization: output.has_diarization ?? false,
        inputKey: null,
      },
    });

    if (job.inputKey && r2Configured()) {
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
  } else {
    const errorMsg = output?.error ?? error ?? `RunPod status: ${status}`;

    await prisma.transcriptionJob.update({
      where: { id: job.id },
      data: { status: "FAILED", errorMsg, inputKey: null },
    });

    if (job.inputKey && r2Configured()) {
      deleteFromR2(job.inputKey).catch((err) =>
        console.warn(`[webhook/transcription] R2 cleanup failed for key=${job.inputKey}:`, err)
      );
    }

    notifyUser(job.userId, { jobType: "transcription", jobId: job.id, status: "FAILED", errorMsg });
    console.error(`[webhook/transcription] job=${job.id} failed: ${errorMsg}`);
  }

  return NextResponse.json({ ok: true });
}
