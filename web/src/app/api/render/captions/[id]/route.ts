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
import { getR2PublicUrl, deleteFromR2, r2Configured } from "@/lib/r2";
import { fetchRunpodStatus, runpodConfigured } from "@/lib/runpod";

const RUNPOD_API_KEY     = process.env.RUNPOD_API_KEY;
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID;

/** Jobs PROCESSING without resolution for longer than this are considered stalled. */
const STALL_MS = 2 * 60 * 60 * 1000; // 2 hours

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
      srtContent: job.srtContent ?? null,
      presetId: job.presetId ?? null,
    });
  }
  if (job.status === "FAILED") {
    return NextResponse.json({ status: "FAILED", error: job.errorMsg ?? "Le rendu a échoué" });
  }

  // ─── Stall detection ─────────────────────────────────────────────────────
  // Gate: only declare "stall" on jobs that were actually submitted to RunPod.
  // A QUEUED job with no runpodJobId is pre-submit (e.g. create race) — give it
  // a shorter grace window and a distinct message so it can be distinguished.
  if (job.status === "PROCESSING" || job.status === "QUEUED") {
    const ageMs = Date.now() - job.updatedAt.getTime();
    const stallWindow = job.runpodJobId ? STALL_MS : Math.min(STALL_MS, 15 * 60 * 1000); // 15 min for unsubmitted
    if (ageMs > stallWindow) {
      const errorMsg = job.runpodJobId
        ? "Le rendu RunPod n'a plus répondu depuis plus de 2 heures"
        : "Le job n'a jamais été soumis à RunPod — il peut être soumis à nouveau";
      const stalled = await prisma.captionJob.update({
        where: { id: job.id },
        data: { status: "FAILED", errorMsg },
      });
      console.warn(`[render/captions/status] job ${job.id} stalled after ${Math.round(ageMs / 60_000)} min (runpodJobId=${job.runpodJobId ?? "none"}) — marked FAILED`);
      return NextResponse.json({ status: stalled.status, error: errorMsg });
    }
  }

  // ─── Si PROCESSING, interroger RunPod ────────────────────────────────────
  if (job.status === "PROCESSING" && job.runpodJobId) {
    if (!RUNPOD_API_KEY || !RUNPOD_ENDPOINT_ID || !runpodConfigured()) {
      return NextResponse.json({ status: job.status });
    }

    try {
      const runpodRes = await fetchRunpodStatus<{ video_url?: string; output_key?: string }>(
        RUNPOD_ENDPOINT_ID,
        RUNPOD_API_KEY,
        job.runpodJobId
      );

      if (runpodRes.status === "COMPLETED" && runpodRes.output) {
        const outputKey  = runpodRes.output.output_key ?? job.outputKey ?? "";
        const videoUrl   =
          runpodRes.output.video_url ??
          (outputKey ? getR2PublicUrl(outputKey) : null);

        await prisma.captionJob.update({
          where: { id: job.id },
          data:  { status: "COMPLETED", outputUrl: videoUrl ?? undefined, inputKey: null },
        });
        // Delete source video — no longer needed
        if (job.inputKey && r2Configured()) {
          deleteFromR2(job.inputKey).catch(() => { /* ignore */ });
        }
        return NextResponse.json({ status: "COMPLETED", videoUrl });
      }

      if (
        runpodRes.status === "FAILED" ||
        runpodRes.status === "CANCELLED" ||
        runpodRes.status === "TIMED_OUT"
      ) {
        const errorMsg = runpodRes.error ?? `RunPod job ${runpodRes.status}`;
        await prisma.captionJob.update({
          where: { id: job.id },
          data:  { status: "FAILED", errorMsg, inputKey: null },
        });
        if (job.inputKey && r2Configured()) {
          deleteFromR2(job.inputKey).catch(() => { /* ignore */ });
        }
        return NextResponse.json({ status: "FAILED", error: errorMsg });
      }

      // IN_QUEUE ou IN_PROGRESS
      return NextResponse.json({ status: "PROCESSING" });
    } catch (err) {
      console.error("[render/captions/status] RunPod status fetch failed:", err);
      return NextResponse.json({ status: job.status, runpodUnreachable: true });
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
  console.warn(`[captions/DELETE] admin=${session.user.id} deleted captionJob=${id} status=${job.status}`);
  return NextResponse.json({ ok: true });
}
