/**
 * GET /api/render/captions/[id]
 *
 * Retourne le statut d'un CaptionJob.
 * - Si le job est PROCESSING, vérifie l'état côté RunPod et met à jour la DB.
 * - Quand RunPod indique COMPLETED, met outputUrl en DB et retourne la vidéo.
 *
 * Réponse :
 *   {
 *     status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED",
 *     videoUrl?: string,   // URL R2 publique quand COMPLETED
 *     progress?: number,   // 0.0 – 1.0 (optionnel, si RunPod le fournit)
 *     error?: string,
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getR2PublicUrl } from "@/lib/r2";

const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID;

// RunPod status values
type RunpodStatus =
  | "IN_QUEUE"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "TIMED_OUT";

interface RunpodStatusResponse {
  id: string;
  status: RunpodStatus;
  output?: { video_url?: string; output_key?: string };
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
  // ─── Auth ────────────────────────────────────────────────────────────────
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await params;

  // ─── Charger le job DB ───────────────────────────────────────────────────
  const job = await prisma.captionJob.findUnique({ where: { id } });

  if (!job) {
    return NextResponse.json({ error: "Job introuvable" }, { status: 404 });
  }
  if (job.userId !== session.user.id) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  // ─── Si déjà terminé, retourner directement ──────────────────────────────
  if (job.status === "COMPLETED") {
    return NextResponse.json({
      status: "COMPLETED",
      videoUrl: job.outputUrl,
    });
  }
  if (job.status === "FAILED") {
    return NextResponse.json({ status: "FAILED", error: "Le rendu a échoué" });
  }

  // ─── Mode local : DONE (équivalent COMPLETED) ─────────────────────────────
  if (job.status === "DONE") {
    return NextResponse.json({ status: "DONE", videoUrl: job.outputUrl });
  }

  // ─── Si PROCESSING, interroger RunPod ────────────────────────────────────
  if (job.status === "PROCESSING" && job.runpodJobId) {
    if (!RUNPOD_API_KEY || !RUNPOD_ENDPOINT_ID) {
      return NextResponse.json({ status: job.status });
    }

    try {
      const runpodStatus = await fetchRunpodStatus(job.runpodJobId);

      if (
        runpodStatus.status === "COMPLETED" &&
        runpodStatus.output
      ) {
        // Build the public URL from the output key
        const outputKey =
          runpodStatus.output.output_key ?? job.outputKey ?? "";
        const videoUrl =
          runpodStatus.output.video_url ??
          (outputKey ? getR2PublicUrl(outputKey) : null);

        // Mettre à jour la DB
        await prisma.captionJob.update({
          where: { id: job.id },
          data: {
            status: "COMPLETED",
            outputUrl: videoUrl ?? undefined,
          },
        });

        return NextResponse.json({ status: "COMPLETED", videoUrl });
      }

      if (
        runpodStatus.status === "FAILED" ||
        runpodStatus.status === "CANCELLED" ||
        runpodStatus.status === "TIMED_OUT"
      ) {
        await prisma.captionJob.update({
          where: { id: job.id },
          data: { status: "FAILED" },
        });
        return NextResponse.json({
          status: "FAILED",
          error: runpodStatus.error ?? `RunPod job ${runpodStatus.status}`,
        });
      }

      // IN_QUEUE ou IN_PROGRESS → on retourne PROCESSING
      return NextResponse.json({ status: "PROCESSING" });
    } catch (err) {
      console.error("[render/captions/status] RunPod status fetch failed:", err);
      // On retourne quand même le statut DB sans planter
      return NextResponse.json({ status: job.status });
    }
  }

  // QUEUED ou statut inconnu
  return NextResponse.json({ status: job.status });
}

// DELETE /api/render/captions/[id] — admin only
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }
  const { id } = await params;
  const job = await prisma.captionJob.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "Job introuvable" }, { status: 404 });
  await prisma.captionJob.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
