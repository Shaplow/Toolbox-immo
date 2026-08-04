import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { canManageMediaAssets } from "@/lib/permissions/mediaLibrary";
import { prisma } from "@/lib/prisma";
import { submitRunpodJob, runpodConfigured } from "@/lib/runpod";
import { getRunpodWebhookUrl } from "@/lib/webhooks/runpod";

type Params = { params: Promise<{ assetId: string }> };

const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY ?? "";
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID ?? "";

/**
 * POST /api/admin/libraries/media/assets/[assetId]/edit
 *
 * Corps JSON : { trimStart?, trimEnd?, mixToMono?, normalize? }
 * Crée un MediaEditJob, soumet à RunPod avec webhookUrl, retourne { jobId }.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !canManageMediaAssets(userContext.effectiveUser.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { assetId } = await params;

  let asset;
  try {
    asset = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
  } catch (err) {
    console.error(`[admin/libraries/media/assets/${assetId}/edit] findUnique:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
  if (!asset) {
    return NextResponse.json({ error: "Asset introuvable" }, { status: 404 });
  }
  if (!asset.mimeType.startsWith("video/")) {
    return NextResponse.json({ error: "Seuls les assets vidéo peuvent être édités" }, { status: 400 });
  }

  // ── Validate params ─────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const trimStart = body.trimStart != null ? Number(body.trimStart) : null;
  const trimEnd = body.trimEnd != null ? Number(body.trimEnd) : null;
  const mixToMono = Boolean(body.mixToMono ?? false);
  const normalize = Boolean(body.normalize ?? false);
  const gainDbRaw = body.gainDb != null ? Number(body.gainDb) : null;
  const gainDb = gainDbRaw !== null && !isNaN(gainDbRaw) && gainDbRaw !== 0
    ? Math.max(-24, Math.min(24, gainDbRaw))
    : null;

  if (trimStart !== null && (isNaN(trimStart) || trimStart < 0)) {
    return NextResponse.json({ error: "trimStart invalide" }, { status: 400 });
  }
  if (trimEnd !== null && (isNaN(trimEnd) || trimEnd <= 0)) {
    return NextResponse.json({ error: "trimEnd invalide" }, { status: 400 });
  }
  if (trimStart !== null && trimEnd !== null && trimEnd <= trimStart) {
    return NextResponse.json({ error: "trimEnd doit être supérieur à trimStart" }, { status: 400 });
  }
  // Validate trim bounds against known asset duration (skip if duration is null/0 — probe may have failed on upload).
  const knownDuration = typeof asset.duration === "number" && asset.duration > 0 ? asset.duration : null;
  if (knownDuration !== null) {
    if (trimStart !== null && trimStart >= knownDuration) {
      return NextResponse.json({ error: "trimStart dépasse la durée de l'asset" }, { status: 400 });
    }
    if (trimEnd !== null && trimEnd > knownDuration + 1) {
      return NextResponse.json({ error: "trimEnd dépasse la durée de l'asset" }, { status: 400 });
    }
  }

  const editParams = {
    ...(trimStart !== null && { trimStart }),
    ...(trimEnd !== null && { trimEnd }),
    mixToMono,
    normalize,
    ...(gainDb !== null && { gainDb }),
  };

  // Reject no-op jobs (nothing to do — saves RunPod credit and avoids blocking concurrent edits).
  if (trimStart === null && trimEnd === null && !mixToMono && !normalize && gainDb === null) {
    return NextResponse.json({ error: "Aucune opération à effectuer" }, { status: 400 });
  }

  // ── Check no active job and create atomically ────────────────────────────
  // The check + create are wrapped in a transaction so two concurrent requests
  // for the same asset cannot both pass the active-job guard simultaneously.
  let conflictJobId: string | undefined;
  const job = await prisma.$transaction(async (tx) => {
    const existing = await tx.mediaEditJob.findFirst({
      where: { assetId, status: { in: ["pending", "processing"] } },
    });
    if (existing) {
      conflictJobId = existing.id;
      return null;
    }
    return tx.mediaEditJob.create({
      data: {
        assetId,
        status: "pending",
        params: JSON.stringify(editParams),
      },
    });
  });
  if (!job) {
    return NextResponse.json(
      { error: "Un job d'édition est déjà en cours pour cet asset", jobId: conflictJobId },
      { status: 409 }
    );
  }

  // ── Submit to RunPod ─────────────────────────────────────────────────────
  if (!runpodConfigured()) {
    // Dev fallback — leave job in "pending" state, return jobId for polling
    console.warn(`[admin/libraries/media/assets/${assetId}/edit] RunPod not configured — job pending`);
    return NextResponse.json({ jobId: job.id, status: "pending" });
  }

  try {
    const webhookUrl = getRunpodWebhookUrl("/api/webhooks/runpod/media-edit");
    const runpodResp = await submitRunpodJob<{ id: string }>(
      RUNPOD_ENDPOINT_ID,
      RUNPOD_API_KEY,
      {
        input: {
          job_type: "media_edit",
          job_id: job.id,
          asset_url: asset.url,
          r2_key: asset.r2Key,
          params: editParams,
        },
        webhook: webhookUrl,
      }
    );

    await prisma.mediaEditJob.update({
      where: { id: job.id },
      data: {
        status: "processing",
        runpodId: runpodResp.id,
      },
    });

    return NextResponse.json({ jobId: job.id, status: "processing" });
  } catch (err) {
    // RunPod submit failed — mark job as failed
    await prisma.mediaEditJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        errorMsg: String(err),
      },
    });
    console.error(`[admin/libraries/media/assets/${assetId}/edit] RunPod submit failed:`, err);
    return NextResponse.json(
      { error: "Échec de la soumission RunPod", detail: String(err) },
      { status: 502 }
    );
  }
}

/**
 * GET /api/admin/libraries/media/assets/[assetId]/edit
 *
 * Retourne le dernier MediaEditJob pour cet asset.
 * Utilisé par le client pour le polling pendant le traitement.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !canManageMediaAssets(userContext.effectiveUser.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { assetId } = await params;

  const job = await prisma.mediaEditJob.findFirst({
    where: { assetId },
    orderBy: { createdAt: "desc" },
  });

  if (!job) {
    return NextResponse.json({ job: null });
  }

  // Fallback poll: if job has been "processing" for > 15 min without a webhook,
  // check RunPod directly (webhook may have been missed).
  if (
    job.status === "processing" &&
    job.runpodId &&
    runpodConfigured() &&
    job.updatedAt.getTime() < Date.now() - 15 * 60 * 1000
  ) {
    try {
      const { fetchRunpodStatus } = await import("@/lib/runpod");
      const rp = await fetchRunpodStatus(RUNPOD_ENDPOINT_ID, RUNPOD_API_KEY, job.runpodId);
      if (rp.status === "COMPLETED" && rp.output) {
        const out = rp.output as { duration?: number; video_url?: string };
        const assetUpdate: Record<string, unknown> = {};
        if (typeof out.duration === "number") assetUpdate.duration = out.duration;
        if (out.video_url) assetUpdate.url = `${out.video_url.split("?")[0]}?v=${Date.now()}`;

        await prisma.$transaction([
          prisma.mediaEditJob.update({ where: { id: job.id }, data: { status: "done" } }),
          ...(Object.keys(assetUpdate).length > 0
            ? [prisma.mediaAsset.update({ where: { id: assetId }, data: assetUpdate })]
            : []),
        ]);
        return NextResponse.json({ job: { ...job, status: "done" } });
      } else if (["FAILED", "CANCELLED", "TIMED_OUT"].includes(rp.status)) {
        await prisma.mediaEditJob.update({
          where: { id: job.id },
          data: { status: "failed", errorMsg: rp.error ?? `RunPod status: ${rp.status}` },
        });
        return NextResponse.json({ job: { ...job, status: "failed" } });
      }
    } catch {
      // Ignore poll errors — return current DB state
    }
  }

  return NextResponse.json({ job });
}
