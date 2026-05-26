/**
 * POST /api/transcription/[id]/submit
 *
 * Soumet un TranscriptionJob en attente (QUEUED) à RunPod.
 * Appeler après que le browser a uploadé le fichier source directement vers R2
 * via l'URL pré-signée retournée par POST /api/transcription.
 */

import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { getR2PublicUrl, objectExistsInR2, r2Configured } from "@/lib/r2";
import { submitRunpodJob, runpodConfigured } from "@/lib/runpod";
import { getRunpodWebhookUrl } from "@/lib/webhooks/runpod";

const RUNPOD_API_KEY     = process.env.RUNPOD_API_KEY;
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID;
const HF_TOKEN           = process.env.HF_TOKEN;
const CAPTIONS_API_URL   = process.env.CAPTIONS_API_URL ?? "http://localhost:8000";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await params;

  const job = await prisma.transcriptionJob.findUnique({ where: { id } });
  if (!job) {
    return NextResponse.json({ error: "Job introuvable" }, { status: 404 });
  }
  if (job.userId !== userContext.effectiveUser.id && !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }
  if (!job.inputKey) {
    return NextResponse.json({ error: "Clé source manquante" }, { status: 400 });
  }
  // ── Mode local dev : R2 non configuré → render-engine local ────────────
  if (!r2Configured()) {
    if (job.enableDiarization && !HF_TOKEN) {
      return NextResponse.json(
        { error: "La diarisation n'est pas disponible sur ce serveur (HF_TOKEN non configuré)." },
        { status: 503 }
      );
    }

    // Vérifier que le fichier local existe avant de démarrer
    const localRelPath  = (job.inputKey ?? "").replace(/^local\//, "");
    if (!localRelPath) {
      return NextResponse.json({ error: "Clé source locale manquante" }, { status: 400 });
    }
    const localFilePath = path.join(process.cwd(), "public", localRelPath);
    let fileBuffer: Buffer;
    try {
      fileBuffer = await readFile(localFilePath);
    } catch {
      return NextResponse.json(
        { error: "Fichier source introuvable. Veuillez relancer l'upload." },
        { status: 422 }
      );
    }

    // Atomic status transition
    const claimed = await prisma.transcriptionJob.updateMany({
      where: { id: job.id, status: "QUEUED" },
      data: { status: "PROCESSING" },
    });
    if (claimed.count === 0) {
      return NextResponse.json({ error: "Job déjà soumis ou terminé" }, { status: 409 });
    }

    const ext = path.extname(localRelPath).slice(1);
    const mimeByExt: Record<string, string> = {
      mp4: "video/mp4", mov: "video/quicktime", mkv: "video/x-matroska",
      webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav",
      m4a: "audio/mp4", flac: "audio/flac", ogg: "audio/ogg", aac: "audio/aac",
    };
    const localForm = new FormData();
    localForm.append(
      "audio",
      new Blob([new Uint8Array(fileBuffer)], { type: mimeByExt[ext] ?? "application/octet-stream" }),
      job.inputFilename ?? `source.${ext}`
    );
    const modelSize = (job.model ?? "turbo") === "turbo" ? "large-v3-turbo" : (job.model ?? "large-v3-turbo");
    localForm.append("model_size", modelSize);
    localForm.append("language", job.language ?? "fr");
    localForm.append("enable_diarization", String(job.enableDiarization));
    if (job.enableDiarization && HF_TOKEN) {
      localForm.append("hf_token", HF_TOKEN);
    }

    try {
      const localRes = await fetch(`${CAPTIONS_API_URL}/api/transcribe`, {
        method: "POST",
        body: localForm,
        signal: AbortSignal.timeout(60 * 60 * 1000), // 1 h max
      });
      if (!localRes.ok) {
        throw new Error(`render-engine ${localRes.status}: ${await localRes.text()}`);
      }
      const data = await localRes.json() as {
        segments: Array<{ start: number; end: number; text: string; speaker?: string }>;
        segment_count: number;
        duration: number;
        language: string;
        has_diarization: boolean;
      };

      // Sauvegarder les segments JSON en local
      const outputRelPath = (job.outputJsonKey ?? "").replace(/^local\//, "");
      if (outputRelPath) {
        const outputFilePath = path.join(process.cwd(), "public", outputRelPath);
        await mkdir(path.dirname(outputFilePath), { recursive: true });
        await writeFile(outputFilePath, JSON.stringify(data.segments, null, 2));
      }

      await prisma.transcriptionJob.update({
        where: { id: job.id },
        data: {
          status: "COMPLETED",
          segmentCount: data.segment_count,
          duration: data.duration,
          hasDiarization: data.has_diarization,
        },
      });
      return NextResponse.json({ jobId: job.id });
    } catch (err) {
      await prisma.transcriptionJob.update({
        where: { id: job.id },
        data: { status: "FAILED", errorMsg: String(err) },
      });
      console.error("[transcription/submit] Local render-engine failed:", err);
      return NextResponse.json(
        { error: `Erreur transcription locale : ${String(err)}` },
        { status: 502 }
      );
    }
  }

  // ── Mode RunPod (R2 configuré) ────────────────────────────────────────────
  if (!RUNPOD_API_KEY || !RUNPOD_ENDPOINT_ID || !runpodConfigured()) {
    return NextResponse.json({ error: "RunPod non configuré" }, { status: 503 });
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
    // R2 head-check threw (credentials broken, network failure). Revert to QUEUED so the
    // user can retry once R2 is back. Do NOT proceed optimistically — the worker would
    // receive a 403/404 download error that is much harder to diagnose.
    await prisma.transcriptionJob.update({
      where: { id: job.id },
      data: { status: "QUEUED" },
    });
    console.error("[transcription/submit] R2 head-check threw — reverting to QUEUED:", err);
    return NextResponse.json(
      { error: "Impossible de vérifier le fichier source (R2 indisponible). Réessayez dans quelques instants." },
      { status: 503 }
    );
  }

  const audioUrl    = getR2PublicUrl(job.inputKey);
  const outputKey   = job.outputJsonKey ?? `transcription/${job.userId}/${Date.now()}/segments.json`;
  const modelSize   = job.model === "turbo" ? "large-v3-turbo" : job.model;
  const webhookUrl  = getRunpodWebhookUrl("/api/webhooks/runpod/transcription");

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
    ...(webhookUrl ? { webhook: webhookUrl } : {}),
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
