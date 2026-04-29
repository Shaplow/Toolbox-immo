/**
 * POST /api/transcription/[id]/submit
 *
 * Soumet un TranscriptionJob en attente (QUEUED) à RunPod.
 * Appeler après que le browser a uploadé le fichier source directement vers R2
 * via l'URL pré-signée retournée par POST /api/transcription.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getR2PublicUrl, objectExistsInR2, r2Configured } from "@/lib/r2";
import { submitRunpodJob, runpodConfigured } from "@/lib/runpod";

const RUNPOD_API_KEY     = process.env.RUNPOD_API_KEY;
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID;
const HF_TOKEN           = process.env.HF_TOKEN;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await params;

  const job = await prisma.transcriptionJob.findUnique({ where: { id } });
  if (!job) {
    return NextResponse.json({ error: "Job introuvable" }, { status: 404 });
  }
  if (job.userId !== session.user.id && session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }
  if (!job.inputKey) {
    return NextResponse.json({ error: "Clé source manquante" }, { status: 400 });
  }
  if (!RUNPOD_API_KEY || !RUNPOD_ENDPOINT_ID || !runpodConfigured()) {
    return NextResponse.json({ error: "RunPod non configuré" }, { status: 503 });
  }
  if (!r2Configured()) {
    return NextResponse.json({ error: "R2 non configuré" }, { status: 503 });
  }
  if (job.enableDiarization && !HF_TOKEN) {
    return NextResponse.json(
      { error: "La diarisation n'est pas disponible sur ce serveur (HF_TOKEN non configuré)." },
      { status: 503 }
    );
  }

  // Atomic status transition — prevents concurrent double-submit
  const claimed = await prisma.transcriptionJob.updateMany({
    where: { id: job.id, status: "QUEUED" },
    data: { status: "PROCESSING" },
  });
  if (claimed.count === 0) {
    return NextResponse.json({ error: "Job déjà soumis ou terminé" }, { status: 409 });
  }

  // Verify the source file was actually uploaded to R2 before committing to RunPod.
  // If the presigned upload failed silently the worker would receive a 403/404 download
  // error, which is hard to diagnose. Catching it here gives a clear actionable message.
  try {
    const exists = await objectExistsInR2(job.inputKey);
    if (!exists) {
      await prisma.transcriptionJob.update({
        where: { id: job.id },
        data: { status: "FAILED", errorMsg: "Fichier source introuvable en R2 — l'upload a peut-être échoué" },
      });
      return NextResponse.json(
        { error: "Fichier source introuvable. Veuillez relancer l'upload." },
        { status: 422 }
      );
    }
  } catch (err) {
    // R2 head-check failure is non-fatal — proceed optimistically and let the worker report
    console.warn("[transcription/submit] R2 head-check failed (proceeding):", err);
  }

  const audioUrl    = getR2PublicUrl(job.inputKey);
  const outputKey   = job.outputJsonKey ?? `transcription/${job.userId}/${Date.now()}/segments.json`;
  const modelSize   = job.model === "turbo" ? "large-v3-turbo" : job.model;

  const payload = {
    input: {
      job_type: "transcribe",
      audio_url: audioUrl,
      output_key: outputKey,
      job_id: job.id,
      model_size: modelSize,
      language: job.language,
      enable_diarization: job.enableDiarization,
      hf_token: job.enableDiarization ? (HF_TOKEN ?? null) : null,
    },
  };

  let runpodJobId: string;
  try {
    const data = await submitRunpodJob<{ id: string }>(
      RUNPOD_ENDPOINT_ID,
      RUNPOD_API_KEY,
      payload,
    );
    runpodJobId = data.id;
  } catch (err) {
    await prisma.transcriptionJob.update({
      where: { id: job.id },
      data: { status: "FAILED", errorMsg: String(err) },
    });
    console.error("[transcription/submit] RunPod submit failed:", err);
    return NextResponse.json({ error: `Échec soumission RunPod : ${String(err)}` }, { status: 502 });
  }

  await prisma.transcriptionJob.update({
    where: { id: job.id },
    data: { runpodJobId, outputJsonKey: outputKey },
  });

  return NextResponse.json({ jobId: job.id });
}
