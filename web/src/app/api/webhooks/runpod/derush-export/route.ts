/**
 * POST /api/webhooks/runpod/derush-export
 *
 * Reçoit la callback RunPod quand un job derush_export termine.
 * Met à jour DerushExport avec la clé R2 du résultat ou l'erreur.
 * Sécurité : voir verifyRunpodWebhook (RUNPOD_WEBHOOK_SECRET).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyRunpodWebhook, parseRunpodWebhookBody } from "@/lib/webhooks/runpod";
import { notifyUser } from "@/lib/sseStore";

type DerushExportOutput = {
  output_key?: string;
  output_filename?: string;
  exported_count?: number;
  export_format?: string;
  error?: string;
};

export async function POST(req: NextRequest) {
  const authError = verifyRunpodWebhook(req);
  if (authError) return authError;

  const parsed = await parseRunpodWebhookBody<DerushExportOutput>(req);
  if (!parsed.ok) return parsed.response;

  const { id: runpodJobId, status, output, error } = parsed.body;

  const exp = await prisma.derushExport.findFirst({ where: { runpodJobId } });
  if (!exp) {
    console.warn(`[webhook/derush-export] Unknown runpodJobId=${runpodJobId}`);
    return NextResponse.json({ ok: true });
  }

  // Idempotent — webhook peut être rejoué
  if (exp.status === "COMPLETED" || exp.status === "FAILED") {
    return NextResponse.json({ ok: true });
  }

  // Retrieve the parent job to get the userId for SSE notification
  const job = await prisma.derushJob.findUnique({
    where: { id: exp.derushJobId },
    select: { userId: true },
  });

  if (status === "COMPLETED" && output && !output.error) {
    await prisma.derushExport.update({
      where: { id: exp.id },
      data: {
        status: "COMPLETED",
        outputKey: output.output_key ?? exp.outputKey,
        outputFilename: output.output_filename ?? exp.outputFilename,
      },
    });

    if (job) {
      notifyUser(job.userId, {
        jobType: "derush_export",
        jobId: exp.id,
        exportId: exp.id,
        status: "COMPLETED",
      });
    }
    console.info(`[webhook/derush-export] export=${exp.id} done`);
  } else {
    const errorMsg = output?.error ?? error ?? `RunPod status: ${status}`;

    await prisma.derushExport.update({
      where: { id: exp.id },
      data: { status: "FAILED", errorMsg },
    });

    if (job) {
      notifyUser(job.userId, {
        jobType: "derush_export",
        jobId: exp.id,
        exportId: exp.id,
        status: "FAILED",
        errorMsg,
      });
    }
    console.error(`[webhook/derush-export] export=${exp.id} failed: ${errorMsg}`);
  }

  return NextResponse.json({ ok: true });
}
