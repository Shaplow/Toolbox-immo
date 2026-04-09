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

const RUNPOD_API_KEY     = process.env.RUNPOD_API_KEY;
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID;

type RunpodStatus =
  | "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT";

interface RunpodStatusResponse {
  id: string;
  status: RunpodStatus;
  output?: {
    output_key?: string;
    segment_count?: number;
    duration?: number;
    language?: string;
    has_diarization?: boolean;
  };
  error?: string;
}

async function fetchRunpodStatus(runpodJobId: string): Promise<RunpodStatusResponse> {
  const res = await fetch(
    `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}/status/${runpodJobId}`,
    {
      headers: { Authorization: `Bearer ${RUNPOD_API_KEY}` },
      cache: "no-store",
    }
  );
  if (!res.ok) {
    throw new Error(`RunPod status API ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

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

  // ─── Si PROCESSING avec runpodJobId, interroger RunPod ───────────────────
  if (job.status === "PROCESSING" && job.runpodJobId && RUNPOD_API_KEY && RUNPOD_ENDPOINT_ID) {
    try {
      const runpodStatus = await fetchRunpodStatus(job.runpodJobId);

      if (runpodStatus.status === "COMPLETED" && runpodStatus.output) {
        const out = runpodStatus.output;
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
        runpodStatus.status === "FAILED" ||
        runpodStatus.status === "CANCELLED" ||
        runpodStatus.status === "TIMED_OUT"
      ) {
        const updated = await prisma.transcriptionJob.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            errorMsg: runpodStatus.error ?? `RunPod job ${runpodStatus.status}`,
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
    }
  }

  return NextResponse.json(formatJob(job));
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
