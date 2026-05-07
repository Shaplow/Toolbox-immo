/**
 * POST /api/derush/[id]/submit
 *
 * Soumet un DerushJob QUEUED à RunPod (job_type: derush_vision).
 * Appeler après que les fichiers vidéo ont été uploadés directement vers R2.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getR2PublicUrl, objectExistsInR2, r2Configured } from "@/lib/r2";
import { submitRunpodJob } from "@/lib/runpod";
import { getRunpodWebhookUrl } from "@/lib/webhooks/runpod";

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

  const job = await prisma.derushJob.findUnique({
    where: { id },
    include: { preset: true, format: true },
  });
  if (!job) return NextResponse.json({ error: "Job introuvable" }, { status: 404 });
  if (job.userId !== session.user.id && session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }
  if (job.status !== "QUEUED") {
    const statusMessages: Record<string, string> = {
      PROCESSING: "Job déjà en cours de traitement RunPod",
      COMPLETED: "Job déjà terminé avec succès",
      FAILED: "Job en état d'erreur — créez un nouveau job",
    };
    return NextResponse.json(
      { error: statusMessages[job.status] ?? `Job dans un état non soumettable : ${job.status}` },
      { status: 409 }
    );
  }
  if (!RUNPOD_API_KEY || !RUNPOD_ENDPOINT_ID) {
    return NextResponse.json({ error: "RunPod non configuré" }, { status: 503 });
  }
  if (!r2Configured()) {
    return NextResponse.json({ error: "R2 non configuré" }, { status: 503 });
  }

  // Atomic status transition — prevents concurrent double-submit
  const claimed = await prisma.derushJob.updateMany({
    where: { id: job.id, status: "QUEUED" },
    data: { status: "PROCESSING" },
  });
  if (claimed.count === 0) {
    return NextResponse.json({ error: "Job déjà soumis ou terminé" }, { status: 409 });
  }

  const inputFiles = JSON.parse(job.inputFiles) as { key: string; filename: string }[];
  if (inputFiles.length === 0) {
    await prisma.derushJob.update({
      where: { id: job.id },
      data: { status: "FAILED", errorMsg: "Aucun fichier source enregistré" },
    });
    return NextResponse.json({ error: "Aucun fichier source enregistré" }, { status: 400 });
  }

  // Verify each source file was actually uploaded to R2 before committing to RunPod.
  // Mirrors the same guard in /api/render/captions/[id]/submit and /api/transcription/[id]/submit.
  try {
    const missingKeys: string[] = [];
    for (const file of inputFiles) {
      const exists = await objectExistsInR2(file.key);
      if (!exists) missingKeys.push(file.filename);
    }
    if (missingKeys.length > 0) {
      await prisma.derushJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          errorMsg: `Fichier(s) source introuvable(s) en R2 — l'upload a peut-être échoué : ${missingKeys.join(", ")}`,
        },
      });
      return NextResponse.json(
        { error: `Fichier(s) source introuvable(s). Veuillez relancer l'upload : ${missingKeys.join(", ")}` },
        { status: 422 }
      );
    }
  } catch (err) {
    // R2 head-check failure is non-fatal — proceed optimistically and let the worker report
    console.warn("[derush/submit] R2 head-check failed (proceeding):", err);
  }

  const safeUserId = job.userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const outputPrefix = `derush/${safeUserId}/${job.id}`;
  const outputJsonKey = `${outputPrefix}/segments.json`;

  // Build video URLs from R2
  const videoUrls = inputFiles.map((f) => getR2PublicUrl(f.key));
  const videoR2Keys = inputFiles.map((f) => f.key);
  const videoFilenames = inputFiles.map((f) => f.filename);

  // Preset config
  const presetConfig = job.preset
    ? (JSON.parse(job.preset.config) as Record<string, unknown>)
    : null;

  // Transcription reuse URL
  let transcriptionOutputUrl: string | null = null;
  if (job.transcriptionJobId && job.analysisMode === "transcription") {
    const tJob = await prisma.transcriptionJob.findUnique({
      where: { id: job.transcriptionJobId },
    });
    if (tJob?.outputJsonKey) {
      transcriptionOutputUrl = getR2PublicUrl(tJob.outputJsonKey);
    }
  }
  if (job.transcriptionInputKey && job.analysisMode === "transcription" && !transcriptionOutputUrl) {
    transcriptionOutputUrl = getR2PublicUrl(job.transcriptionInputKey);
  }

  const webhookUrl = getRunpodWebhookUrl("/api/webhooks/runpod/derush");
  const payload = {
    input: {
      job_type: "derush_vision",
      job_id: job.id,
      analysis_mode: job.analysisMode,
      video_urls: videoUrls,
      video_r2_keys: videoR2Keys,
      video_filenames: videoFilenames,
      output_prefix: outputPrefix,
      vision_provider: job.visionProvider,
      preset_config: presetConfig,
      // Format-aware segmentation
      format_hint: job.format?.contextPrompt ?? null,
      format_config: job.format
        ? { silence_threshold: job.format.silenceThreshold, export_mode: job.format.exportMode }
        : null,
      enable_diarization: job.enableDiarization,
      ...(transcriptionOutputUrl ? { transcription_output_url: transcriptionOutputUrl } : {}),
    },
    ...(webhookUrl ? { webhook: webhookUrl } : {}),
  };

  type RunpodSubmitResponse = { id: string };
  let runpodRes: RunpodSubmitResponse;
  try {
    runpodRes = await submitRunpodJob<RunpodSubmitResponse>(
      RUNPOD_ENDPOINT_ID,
      RUNPOD_API_KEY,
      payload
    );
  } catch (err) {
    await prisma.derushJob.update({
      where: { id: job.id },
      data: { status: "FAILED", errorMsg: String(err) },
    });
    console.error("[derush/submit] RunPod submit failed:", err);
    return NextResponse.json({ error: "Erreur lors de la soumission RunPod" }, { status: 502 });
  }

  const updated = await prisma.derushJob.update({
    where: { id: job.id },
    data: {
      runpodJobId: runpodRes.id,
      outputJsonKey,
    },
  });

  return NextResponse.json({ jobId: updated.id, runpodJobId: runpodRes.id });
}
