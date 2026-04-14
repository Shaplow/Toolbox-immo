/**
 * GET /api/derush/[id]/export/[eid]
 * Statut d'un export spécifique. Si PROCESSING avec runpodJobId, interroge RunPod.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const RUNPOD_API_KEY     = process.env.RUNPOD_API_KEY;
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID;

type RunpodStatus =
  | "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT";

interface RunpodStatusResponse {
  id: string;
  status: RunpodStatus;
  output?: {
    output_key?: string;
    exported_count?: number;
    export_format?: string;
    encoding_mode?: string;
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

  // Poll RunPod si PROCESSING
  if (exp.status === "PROCESSING" && exp.runpodJobId && RUNPOD_API_KEY && RUNPOD_ENDPOINT_ID) {
    try {
      const rp = await fetchRunpodStatus(exp.runpodJobId);

      if (rp.status === "COMPLETED" && rp.output) {
        exp = await prisma.derushExport.update({
          where: { id: eid },
          data: {
            status: "COMPLETED",
            outputKey: rp.output.output_key ?? exp.outputKey,
          },
        });
        return NextResponse.json(formatExport(exp));
      }

      if (["FAILED", "CANCELLED", "TIMED_OUT"].includes(rp.status)) {
        exp = await prisma.derushExport.update({
          where: { id: eid },
          data: {
            status: "FAILED",
            errorMsg: rp.error ?? `RunPod job ${rp.status}`,
          },
        });
        return NextResponse.json(formatExport(exp));
      }
    } catch (err) {
      console.error("[derush/export/status] RunPod poll failed:", err);
    }
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
