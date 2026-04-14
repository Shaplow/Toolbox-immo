/**
 * GET /api/derush/[id]
 * Retourne le statut d'un DerushJob. Si PROCESSING avec runpodJobId, interroge RunPod.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const RUNPOD_API_KEY      = process.env.RUNPOD_API_KEY;
const RUNPOD_ENDPOINT_ID  = process.env.RUNPOD_ENDPOINT_ID;

type RunpodStatus =
  | "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT";

interface RunpodStatusResponse {
  id: string;
  status: RunpodStatus;
  output?: {
    output_key?: string;
    segment_count?: number;
    total_duration?: number;
    analysis_mode?: string;
    error?: string;
  };
  error?: string;
}

async function fetchRunpodStatus(jobId: string): Promise<RunpodStatusResponse> {
  const res = await fetch(
    `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}/status/${jobId}`,
    {
      headers: { Authorization: `Bearer ${RUNPOD_API_KEY}` },
      cache: "no-store",
    }
  );
  if (!res.ok) throw new Error(`RunPod ${res.status}: ${await res.text()}`);
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
  const job = await prisma.derushJob.findUnique({
    where: { id },
    include: { preset: { select: { id: true, name: true } } },
  });
  if (!job) return NextResponse.json({ error: "Job introuvable" }, { status: 404 });
  if (job.userId !== session.user.id && session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  // Terminal states — retourner directement
  if (job.status === "COMPLETED" || job.status === "FAILED") {
    return NextResponse.json(formatJob(job));
  }

  // Poll RunPod si PROCESSING
  if (job.status === "PROCESSING" && job.runpodJobId && RUNPOD_API_KEY && RUNPOD_ENDPOINT_ID) {
    try {
      const rp = await fetchRunpodStatus(job.runpodJobId);

      if (rp.status === "COMPLETED" && rp.output) {
        const out = rp.output;
        const updated = await prisma.derushJob.update({
          where: { id: job.id },
          data: {
            status: "COMPLETED",
            outputJsonKey: out.output_key ?? job.outputJsonKey,
            segmentCount: out.segment_count ?? null,
            totalDuration: out.total_duration ?? null,
          },
          include: { preset: { select: { id: true, name: true } } },
        });
        return NextResponse.json(formatJob(updated));
      }

      if (["FAILED", "CANCELLED", "TIMED_OUT"].includes(rp.status)) {
        const updated = await prisma.derushJob.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            errorMsg: rp.error ?? `RunPod job ${rp.status}`,
          },
          include: { preset: { select: { id: true, name: true } } },
        });
        return NextResponse.json(formatJob(updated));
      }
    } catch (err) {
      console.error("[derush/status] RunPod poll failed:", err);
    }
  }

  return NextResponse.json(formatJob(job));
}

function formatJob(job: {
  id: string;
  status: string;
  analysisMode: string;
  inputFiles: string;
  visionProvider: string;
  transcriptionJobId: string | null;
  presetId: string | null;
  preset?: { id: string; name: string } | null;
  runpodJobId: string | null;
  outputJsonKey: string | null;
  segmentCount: number | null;
  totalDuration: number | null;
  errorMsg: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: job.id,
    status: job.status,
    analysisMode: job.analysisMode,
    visionProvider: job.visionProvider,
    transcriptionJobId: job.transcriptionJobId,
    presetId: job.presetId,
    presetName: job.preset?.name ?? null,
    fileCount: (JSON.parse(job.inputFiles) as unknown[]).length,
    segmentCount: job.segmentCount,
    totalDuration: job.totalDuration,
    hasOutput: !!job.outputJsonKey,
    errorMsg: job.errorMsg,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await params;
  const job = await prisma.derushJob.findUnique({ where: { id }, select: { userId: true } });
  if (!job) return NextResponse.json({ error: "Job introuvable" }, { status: 404 });
  if (job.userId !== session.user.id && session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  await prisma.derushJob.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
