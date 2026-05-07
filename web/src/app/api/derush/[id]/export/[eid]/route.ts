/**
 * GET /api/derush/[id]/export/[eid]
 * Statut d'un export spécifique. Si PROCESSING avec runpodJobId, interroge RunPod.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveRunpodJobPhase } from "@/lib/runpod";

const RUNPOD_API_KEY     = process.env.RUNPOD_API_KEY;
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID;

/** 2 hours without resolution → stalled */
const EXPORT_STALL_MS = 2 * 60 * 60 * 1000;

type DerushExportOutput = {
  output_key?: string;
  exported_count?: number;
  export_format?: string;
  encoding_mode?: string;
  error?: string;
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; eid: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id, eid } = await params;

  const job = await prisma.derushJob.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "Job introuvable" }, { status: 404 });
  if (job.userId !== session.user.id && session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  let exp = await prisma.derushExport.findUnique({ where: { id: eid } });
  if (!exp || exp.derushJobId !== id) {
    return NextResponse.json({ error: "Export introuvable" }, { status: 404 });
  }

  // Terminal states — retourner directement
  if (exp.status === "COMPLETED" || exp.status === "FAILED") {
    return NextResponse.json(formatExport(exp));
  }

  // Poll RunPod si PROCESSING — uses shared helper (stall detection included)
  if (exp.status === "PROCESSING" && exp.runpodJobId && RUNPOD_API_KEY && RUNPOD_ENDPOINT_ID) {
    const phase = await resolveRunpodJobPhase<DerushExportOutput>(
      RUNPOD_ENDPOINT_ID,
      RUNPOD_API_KEY,
      exp.runpodJobId,
      exp.updatedAt,
      EXPORT_STALL_MS
    );

    if (phase.phase === "completed" && phase.output) {
      exp = await prisma.derushExport.update({
        where: { id: eid },
        data: {
          status: "COMPLETED",
          outputKey: phase.output.output_key ?? exp.outputKey,
        },
      });
    } else if (phase.phase === "failed" || phase.phase === "stalled") {
      const errorMsg = phase.phase === "stalled"
        ? "Export RunPod bloqué — aucune réponse après 2h"
        : (phase as { phase: "failed"; error: string }).error;
      exp = await prisma.derushExport.update({
        where: { id: eid },
        data: { status: "FAILED", errorMsg },
      });
    }
    // phase "in_progress" or "unreachable" — return current state
  }

  return NextResponse.json(formatExport(exp));
}

function formatExport(e: {
  id: string;
  derushJobId: string;
  status: string;
  exportFormat: string;
  workflow: string | null;
  comboFormats: string;
  accurateTrim: boolean;
  outputKey: string | null;
  outputFilename: string | null;
  runpodJobId: string | null;
  errorMsg: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: e.id,
    derushJobId: e.derushJobId,
    status: e.status,
    exportFormat: e.exportFormat,
    workflow: e.workflow,
    comboFormats: JSON.parse(e.comboFormats) as string[],
    accurateTrim: e.accurateTrim,
    outputKey: e.outputKey,
    outputFilename: e.outputFilename,
    runpodJobId: e.runpodJobId,
    errorMsg: e.errorMsg,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}
