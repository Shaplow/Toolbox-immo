/**
 * GET /api/transcription/[id]
 *
 * Retourne le statut d'un TranscriptionJob.
 * Si le job est PROCESSING et a un runpodJobId, interroge RunPod et met à jour la DB.
 *
 * Réponse :
 *   {
 *     id, status, inputFilename, model, language,
 *     enableDiarization, hasDiarization,
 *     segmentCount?, duration?, createdAt, errorMsg?
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deleteFromR2, r2Configured } from "@/lib/r2";
import { fetchRunpodStatus } from "@/lib/runpod";

const RUNPOD_API_KEY     = process.env.RUNPOD_API_KEY;
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID;
const HF_TOKEN           = process.env.HF_TOKEN;

/** Jobs PROCESSING/QUEUED without resolution for longer than this are considered stalled. */
const STALL_MS = 2 * 60 * 60 * 1000; // 2 hours

const ALLOWED_MODELS = new Set([
  "turbo", "large-v3", "large-v3-turbo", "medium", "small", "base", "tiny",
]);

const ALLOWED_LANGUAGE_RE = /^[a-z]{2,3}$|^auto$/;

function sanitizeModel(value: unknown): string {
  const sanitizedValue = String(value ?? "turbo").trim().toLowerCase();
  return ALLOWED_MODELS.has(sanitizedValue) ? sanitizedValue : "turbo";
}

function sanitizeLanguage(value: unknown): string {
  const sanitizedValue = String(value ?? "fr").trim().toLowerCase();
  return ALLOWED_LANGUAGE_RE.test(sanitizedValue) ? sanitizedValue : "fr";
}

function toBoolean(value: unknown, defaultValue = false): boolean {
  if (value == null) return defaultValue;
  const sanitizedValue = String(value).trim().toLowerCase();
  return sanitizedValue === "true" || sanitizedValue === "1" || sanitizedValue === "yes";
}

type RunpodOutput = {
  output_key?: string;
  segment_count?: number;
  duration?: number;
  language?: string;
  has_diarization?: boolean;
};

export async function GET(
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

  // ─── Terminal states — retourner directement ──────────────────────────────
  if (job.status === "COMPLETED" || job.status === "FAILED") {
    return NextResponse.json(formatJob(job));
  }
  // ─── Stall detection ─────────────────────────────────────────────────────
  // Gate: jobs that were submitted to RunPod use STALL_MS; jobs that are still
  // QUEUED (presigned path — browser hasn't uploaded yet) get a shorter 30-min
  // grace window before being considered abandoned.
  if (job.status === "PROCESSING" || job.status === "QUEUED") {
    const ageMs = Date.now() - job.updatedAt.getTime();
    const isSubmitted = !!job.runpodJobId;
    const stallWindow = isSubmitted ? STALL_MS : 30 * 60 * 1000; // 30 min for unsubmitted
    if (ageMs > stallWindow) {
      const errorMsg = isSubmitted
        ? "Job bloqué : pas de réponse depuis plus de 2 heures"
        : "Job abandonné : le fichier source n'a jamais été uploadé";
      const updated = await prisma.transcriptionJob.update({
        where: { id: job.id },
        data: { status: "FAILED", errorMsg },
      });
      console.warn(`[transcription/status] job ${job.id} stalled after ${Math.round(ageMs / 60_000)} min (runpodJobId=${job.runpodJobId ?? "none"}) — marked FAILED`);
      return NextResponse.json(formatJob(updated));
    }
  }
  // ─── Si PROCESSING avec runpodJobId, interroger RunPod ───────────────────
  if (job.status === "PROCESSING" && job.runpodJobId && RUNPOD_API_KEY && RUNPOD_ENDPOINT_ID) {
    try {
      const runpodRes = await fetchRunpodStatus<RunpodOutput>(
        RUNPOD_ENDPOINT_ID,
        RUNPOD_API_KEY,
        job.runpodJobId
      );

      if (runpodRes.status === "COMPLETED" && runpodRes.output) {
        const out = runpodRes.output;
        const updated = await prisma.transcriptionJob.update({
          where: { id: job.id },
          data: {
            status: "COMPLETED",
            outputJsonKey: out.output_key ?? job.outputJsonKey,
            segmentCount: out.segment_count ?? null,
            duration: out.duration ?? null,
            hasDiarization: out.has_diarization ?? false,
            // Libérer la clé source — inutile de garder la vidéo/audio en R2
            inputKey: null,
          },
        });
        // Supprimer l'audio source de R2 (temporaire — souvent des rushs lourds)
        if (job.inputKey && r2Configured()) {
          deleteFromR2(job.inputKey).catch(() => { /* ignore */ });
        }
        return NextResponse.json(formatJob(updated));
      }

      if (
        runpodRes.status === "FAILED" ||
        runpodRes.status === "CANCELLED" ||
        runpodRes.status === "TIMED_OUT"
      ) {
        const updated = await prisma.transcriptionJob.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            errorMsg: runpodRes.error ?? `RunPod job ${runpodRes.status}`,
            inputKey: null,
          },
        });
        if (job.inputKey && r2Configured()) {
          deleteFromR2(job.inputKey).catch(() => { /* ignore */ });
        }
        return NextResponse.json(formatJob(updated));
      }
    } catch (err) {
      console.error("[transcription/status] RunPod status fetch failed:", err);
      // Return current DB status but flag that RunPod was unreachable so the
      // client can show a warning rather than silently appearing stuck.
      return NextResponse.json({ ...formatJob(job), runpodUnreachable: true });
    }
  }

  return NextResponse.json(formatJob(job));
}

export async function PATCH(
  req: NextRequest,
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
  if (job.status !== "QUEUED") {
    return NextResponse.json(
      { error: "Seuls les jobs en attente peuvent être modifiés." },
      { status: 409 }
    );
  }

  let body: { model?: unknown; language?: unknown; enable_diarization?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const model = sanitizeModel(body.model);
  const language = sanitizeLanguage(body.language);
  const enableDiarization = toBoolean(body.enable_diarization);

  if (enableDiarization && !HF_TOKEN) {
    return NextResponse.json(
      { error: "La diarisation n'est pas disponible sur ce serveur (HF_TOKEN non configuré)." },
      { status: 503 }
    );
  }

  const updated = await prisma.transcriptionJob.update({
    where: { id: job.id },
    data: {
      model,
      language,
      enableDiarization,
      errorMsg: null,
    },
  });

  return NextResponse.json(formatJob(updated));
}

function formatJob(job: {
  id: string;
  status: string;
  inputFilename: string | null;
  model: string;
  language: string;
  enableDiarization: boolean;
  hasDiarization: boolean;
  segmentCount: number | null;
  duration: number | null;
  createdAt: Date;
  errorMsg: string | null;
  outputJsonKey?: string | null;
}) {
  return {
    id: job.id,
    status: job.status,
    inputFilename: job.inputFilename,
    model: job.model,
    language: job.language,
    enableDiarization: job.enableDiarization,
    hasDiarization: job.hasDiarization,
    segmentCount: job.segmentCount,
    duration: job.duration,
    createdAt: job.createdAt,
    errorMsg: job.errorMsg,
    hasOutput: !!job.outputJsonKey,
  };
}
