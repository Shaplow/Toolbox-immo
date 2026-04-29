/**
 * GET /api/derush/[id]
 * Retourne le statut d'un DerushJob. Si PROCESSING avec runpodJobId, interroge RunPod.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveRunpodJobPhase } from "@/lib/runpod";

const RUNPOD_API_KEY      = process.env.RUNPOD_API_KEY;
const RUNPOD_ENDPOINT_ID  = process.env.RUNPOD_ENDPOINT_ID;

/** Jobs PROCESSING without resolution longer than this are stalled. */
const STALL_MS = 2 * 60 * 60 * 1000; // 2 hours
/** QUEUED jobs that were never submitted are abandoned after this window. */
const PRE_SUBMIT_STALL_MS = 15 * 60 * 1000; // 15 minutes

type DerushJobOutput = {
  output_key?: string;
  segment_count?: number;
  total_duration?: number;
  analysis_mode?: string;
  error?: string;
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

  // Pre-submit stall: QUEUED without runpodJobId never reached RunPod
  if ((job.status === "QUEUED" || job.status === "PROCESSING") && !job.runpodJobId) {
    const ageMs = Date.now() - job.updatedAt.getTime();
    if (ageMs > PRE_SUBMIT_STALL_MS) {
      const errorMsg = "Le job n'a jamais été soumis à RunPod — il peut être soumis à nouveau";
      const updated = await prisma.derushJob.update({
        where: { id: job.id },
        data: { status: "FAILED", errorMsg },
        include: { preset: { select: { id: true, name: true } } },
      });
      console.warn(`[derush/status] job ${job.id} stalled (unsubmitted) after ${Math.round(ageMs / 60_000)} min — marked FAILED`);
      return NextResponse.json(formatJob(updated));
    }
    return NextResponse.json(formatJob(job));
  }

  // Poll RunPod si PROCESSING
  if (job.status === "PROCESSING" && job.runpodJobId && RUNPOD_API_KEY && RUNPOD_ENDPOINT_ID) {
    const resolved = await resolveRunpodJobPhase<DerushJobOutput>(
      RUNPOD_ENDPOINT_ID,
      RUNPOD_API_KEY,
      job.runpodJobId,
      job.updatedAt,
      STALL_MS
    );

    if (resolved.phase === "completed") {
      const out = resolved.output;
      const updated = await prisma.derushJob.update({
        where: { id: job.id },
        data: {
          status: "COMPLETED",
          outputJsonKey: out?.output_key ?? job.outputJsonKey,
          segmentCount: out?.segment_count ?? null,
          totalDuration: out?.total_duration ?? null,
        },
        include: { preset: { select: { id: true, name: true } } },
      });
      return NextResponse.json(formatJob(updated));
    }

    if (resolved.phase === "failed" || resolved.phase === "stalled") {
      const errorMsg =
        resolved.phase === "stalled"
          ? "Le job RunPod n'a plus répondu depuis plus de 2 heures"
          : (resolved as { phase: "failed"; error: string }).error;
      const updated = await prisma.derushJob.update({
        where: { id: job.id },
        data: { status: "FAILED", errorMsg },
        include: { preset: { select: { id: true, name: true } } },
      });
      if (resolved.phase === "stalled") {
        console.warn(`[derush/status] job ${job.id} stalled (runpodJobId=${job.runpodJobId}) — marked FAILED`);
      }
      return NextResponse.json(formatJob(updated));
    }

    if (resolved.phase === "unreachable") {
      return NextResponse.json({ ...formatJob(job), runpodUnreachable: true });
    }
    // in_progress — fall through
  }

  return NextResponse.json(formatJob(job));
}

function parseInputFiles(raw: string): unknown[] {
  try {
    return JSON.parse(raw) as unknown[];
  } catch {
    return [];
  }
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
    fileCount: parseInputFiles(job.inputFiles).length,
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
