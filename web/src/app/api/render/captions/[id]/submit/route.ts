/**
 * POST /api/render/captions/[id]/submit
 *
 * Soumet un CaptionJob en attente (QUEUED) à RunPod.
 * Appeler après que le browser a uploadé la vidéo source directement vers R2
 * via l'URL pré-signée retournée par POST /api/render/captions (JSON body).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getR2PublicUrl } from "@/lib/r2";
import { submitRunpodJob } from "@/lib/runpod";

const RUNPOD_API_KEY     = process.env.RUNPOD_API_KEY;
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await params;

  const job = await prisma.captionJob.findUnique({ where: { id } });
  if (!job) {
    return NextResponse.json({ error: "Job introuvable" }, { status: 404 });
  }
  if (job.userId !== session.user.id && session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }
  if (!job.inputKey) {
    return NextResponse.json({ error: "Clé source manquante" }, { status: 400 });
  }
  if (!job.outputKey) {
    return NextResponse.json({ error: "Clé de sortie manquante" }, { status: 400 });
  }
  if (!RUNPOD_API_KEY || !RUNPOD_ENDPOINT_ID) {
    return NextResponse.json({ error: "RunPod non configuré" }, { status: 503 });
  }

  // Atomic status transition — prevents concurrent double-submit
  const claimed = await prisma.captionJob.updateMany({
    where: { id: job.id, status: "QUEUED" },
    data:  { status: "PROCESSING" },
  });
  if (claimed.count === 0) {
    return NextResponse.json({ error: "Job déjà soumis ou terminé" }, { status: 409 });
  }

  const videoUrl = getR2PublicUrl(job.inputKey);

  let configData: Record<string, unknown> = {};
  try {
    configData = JSON.parse(job.config) as Record<string, unknown>;
  } catch { /* fallback: empty config */ }

  const payload = {
    input: {
      video_url:      videoUrl,
      srt_content:    job.srtContent ?? "",
      config:         configData,
      preview_mode:   job.previewMode,
      output_key:     job.outputKey,
      caption_job_id: job.id,
    },
  };

  let runpodJobId: string;
  try {
    const data = await submitRunpodJob<{ id: string }>(
      RUNPOD_ENDPOINT_ID,
      RUNPOD_API_KEY,
      payload
    );
    runpodJobId = data.id;
  } catch (err) {
    await prisma.captionJob.update({
      where: { id: job.id },
      data:  { status: "FAILED", errorMsg: String(err) },
    });
    console.error("[render/captions/submit] RunPod submit failed:", err);
    return NextResponse.json({ error: `Échec soumission RunPod : ${String(err)}` }, { status: 502 });
  }

  await prisma.captionJob.update({
    where: { id: job.id },
    data:  { runpodJobId },
  });

  return NextResponse.json({ captionJobId: job.id, runpodJobId });
}
