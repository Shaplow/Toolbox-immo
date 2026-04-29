/**
 * POST /api/webhooks/runpod/derush
 *
 * Reçoit la callback RunPod quand un job derush termine.
 * Met à jour DerushJob avec le résultat ou l'erreur.
 * Sécurité : voir verifyRunpodWebhook (RUNPOD_WEBHOOK_SECRET).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyRunpodWebhook, parseRunpodWebhookBody } from "@/lib/webhooks/runpod";
import { notifyUser } from "@/lib/sseStore";

type DerushOutput = {
  output_key?: string;
  segment_count?: number;
  total_duration?: number;
  analysis_mode?: string;
  error?: string;
};

export async function POST(req: NextRequest) {
  const authError = verifyRunpodWebhook(req);
  if (authError) return authError;

  const parsed = await parseRunpodWebhookBody<DerushOutput>(req);
  if (!parsed.ok) return parsed.response;

  const { id: runpodJobId, status, output, error } = parsed.body;

  // DerushJob.runpodJobId n'a pas de contrainte @unique en DB
  const job = await prisma.derushJob.findFirst({ where: { runpodJobId } });
  if (!job) {
    console.warn(`[webhook/derush] Unknown runpodJobId=${runpodJobId}`);
    return NextResponse.json({ ok: true });
  }

  // Idempotent — webhook peut être rejoué
  if (job.status === "COMPLETED" || job.status === "FAILED") {
    return NextResponse.json({ ok: true });
  }

  if (status === "COMPLETED" && output && !output.error) {
    await prisma.derushJob.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED",
        outputJsonKey: output.output_key ?? job.outputJsonKey,
        segmentCount: output.segment_count ?? null,
        totalDuration: output.total_duration ?? null,
      },
    });

    notifyUser(job.userId, {
      jobType: "derush",
      jobId: job.id,
      status: "COMPLETED",
      segmentCount: output.segment_count ?? null,
      totalDuration: output.total_duration ?? null,
    });
    console.info(`[webhook/derush] job=${job.id} done`);
  } else {
    const errorMsg = output?.error ?? error ?? `RunPod status: ${status}`;

    await prisma.derushJob.update({
      where: { id: job.id },
      data: { status: "FAILED", errorMsg },
    });

    notifyUser(job.userId, { jobType: "derush", jobId: job.id, status: "FAILED", errorMsg });
    console.error(`[webhook/derush] job=${job.id} failed: ${errorMsg}`);
  }

  return NextResponse.json({ ok: true });
}
