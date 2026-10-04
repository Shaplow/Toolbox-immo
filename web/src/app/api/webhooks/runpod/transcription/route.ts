/**
 * POST /api/webhooks/runpod/transcription
 *
 * Reçoit la callback RunPod quand un job transcription termine.
 * L'issue (statut, libération de la source, SSE, chaîne aval) est appliquée par
 * `applyTranscriptionOutcome`, partagé avec le polling de GET
 * /api/transcription/[id] : le premier des deux qui la découvre l'applique,
 * l'autre ne fait rien.
 * Sécurité : voir verifyAndParseRunpodWebhook (RUNPOD_WEBHOOK_SECRET).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyAndParseRunpodWebhook } from "@/lib/webhooks/runpod";
import {
  applyTranscriptionOutcome,
  type TranscriptionOutput,
} from "@/lib/services/transcription/applyOutcome";

type WebhookOutput = TranscriptionOutput & {
  language?: string;
  error?: string;
  job_id?: string;
};

export async function POST(req: NextRequest) {
  // Security-auditor Critical-1 — auth HMAC body-signed.
  const parsed = await verifyAndParseRunpodWebhook<WebhookOutput>(req);
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

  // Idempotent — webhook peut être rejoué (et la transition reste gardée).
  if (job.status === "COMPLETED" || job.status === "FAILED") {
    return NextResponse.json({ ok: true });
  }

  if (status === "COMPLETED" && output && !output.error) {
    const applied = await applyTranscriptionOutcome(job, { kind: "completed", output });
    if (applied) console.info(`[webhook/transcription] job=${job.id} done`);
  } else {
    const errorMsg = output?.error ?? error ?? `RunPod status: ${status}`;
    const applied = await applyTranscriptionOutcome(job, { kind: "failed", errorMsg });
    if (applied) console.error(`[webhook/transcription] job=${job.id} failed: ${errorMsg}`);
  }

  return NextResponse.json({ ok: true });
}
