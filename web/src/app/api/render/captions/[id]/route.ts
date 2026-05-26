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
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { getR2PublicUrl, deleteFromR2, r2Configured } from "@/lib/r2";
import { resolveRunpodJobPhase, runpodConfigured, isPodJobId } from "@/lib/runpod";

const RUNPOD_API_KEY     = process.env.RUNPOD_API_KEY;
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID;

/** Jobs PROCESSING without resolution for longer than this are considered stalled. */
const STALL_MS = 2 * 60 * 60 * 1000; // 2 hours
/** Jobs QUEUED without a runpodJobId for longer than this are considered abandoned. */
const PRE_SUBMIT_STALL_MS = 15 * 60 * 1000; // 15 minutes

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // ─── Auth ────────────────────────────────────────────────────────────────
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await params;

  // ─── Charger le job DB ───────────────────────────────────────────────────
  const job = await prisma.captionJob.findUnique({ where: { id } });

  if (!job) {
    return NextResponse.json({ error: "Job introuvable" }, { status: 404 });
  }
  if (job.userId !== userContext.effectiveUser.id && !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  // ─── Si déjà terminé, retourner directement ──────────────────────────────
  if (job.status === "COMPLETED") {
    return NextResponse.json({
      status: "COMPLETED",
      videoUrl: job.outputUrl,
      srtContent: job.srtContent ?? null,
      presetId: job.presetId ?? null,
    });
  }
  if (job.status === "FAILED") {
    return NextResponse.json({ status: "FAILED", error: job.errorMsg ?? "Le rendu a échoué" });
  }

  // ─── Pre-submit stall (QUEUED without runpodJobId) ──────────────────────
  if ((job.status === "QUEUED" || job.status === "PROCESSING") && !job.runpodJobId) {
    const ageMs = Date.now() - job.updatedAt.getTime();
    if (ageMs > PRE_SUBMIT_STALL_MS) {
      const errorMsg = "Le job n'a jamais été soumis à RunPod — il peut être soumis à nouveau";
      const stalled = await prisma.captionJob.update({
        where: { id: job.id },
        data: { status: "FAILED", errorMsg },
      });
      console.warn(`[render/captions/status] job ${job.id} stalled (unsubmitted) after ${Math.round(ageMs / 60_000)} min — marked FAILED`);
      return NextResponse.json({ status: stalled.status, error: errorMsg });
    }
    return NextResponse.json({ status: job.status });
  }

  // ─── Si PROCESSING avec runpodJobId, déléguer à resolveRunpodJobPhase ────
  if (job.status === "PROCESSING" && job.runpodJobId) {
    if (!RUNPOD_API_KEY || !RUNPOD_ENDPOINT_ID || !runpodConfigured()) {
      return NextResponse.json({ status: job.status });
    }

    type CaptionOutput = { video_url?: string; output_key?: string };
    const resolved = await resolveRunpodJobPhase<CaptionOutput>(
      RUNPOD_ENDPOINT_ID,
      RUNPOD_API_KEY,
      job.runpodJobId,
      job.updatedAt,
      STALL_MS
    );

    if (resolved.phase === "completed") {
      const out = resolved.output;
      const outputKey = out?.output_key ?? job.outputKey ?? "";
      const videoUrl = out?.video_url ?? (outputKey ? getR2PublicUrl(outputKey) : null);
      await prisma.captionJob.update({
        where: { id: job.id },
        data: { status: "COMPLETED", outputUrl: videoUrl ?? undefined, inputKey: null },
      });
      if (job.inputKey && r2Configured()) {
        deleteFromR2(job.inputKey).catch((err) =>
          console.warn(`[captions/status] R2 cleanup failed for key=${job.inputKey}:`, err)
        );
      }
      return NextResponse.json({ status: "COMPLETED", videoUrl });
    }

    if (resolved.phase === "failed" || resolved.phase === "stalled") {
      const errorMsg =
        resolved.phase === "stalled"
          ? "Le rendu RunPod n'a plus répondu depuis plus de 2 heures"
          : (resolved as { phase: "failed"; error: string }).error;
      const stalled = await prisma.captionJob.update({
        where: { id: job.id },
        data: { status: "FAILED", errorMsg, inputKey: null },
      });
      if (job.inputKey && r2Configured()) {
        deleteFromR2(job.inputKey).catch((err) =>
          console.warn(`[captions/status] R2 cleanup failed for key=${job.inputKey}:`, err)
        );
      }
      if (resolved.phase === "stalled") {
        console.warn(`[render/captions/status] job ${job.id} stalled (runpodJobId=${job.runpodJobId}) — marked FAILED`);
      }
      return NextResponse.json({ status: stalled.status, error: errorMsg });
    }

    if (resolved.phase === "unreachable") {
      return NextResponse.json({ status: job.status, runpodUnreachable: true });
    }
    return NextResponse.json({
      status: "PROCESSING",
      runpodQueueStatus: resolved.runpodStatus ?? null,
      isOnPod: isPodJobId(job.runpodJobId),
    });
  }

  // QUEUED avec runpodJobId ou statut inconnu
  return NextResponse.json({ status: job.status });
}

// DELETE /api/render/captions/[id] — admin only
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  if (!userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }
  const { id } = await params;
  const job = await prisma.captionJob.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "Job introuvable" }, { status: 404 });
  await prisma.captionJob.delete({ where: { id } });
  // actualUser.id for audit: who actually performed the deletion (not the impersonated user)
  console.warn(`[captions/DELETE] admin=${userContext.actualUser.id} deleted captionJob=${id} status=${job.status}`);
  return NextResponse.json({ ok: true });
}
