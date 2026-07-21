import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { canAccessMediaLibrary } from "@/lib/permissions/mediaLibrary";
import { prisma } from "@/lib/prisma";
import { submitRunpodJob, runpodConfigured } from "@/lib/runpod";
import { getRunpodWebhookUrl } from "@/lib/webhooks/runpod";

type Params = { params: Promise<{ id: string }> };

const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY ?? "";
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID ?? "";
const PACK_SIZE = 20;

/**
 * POST /api/admin/libraries/media/[libraryId]/autocut-packs
 *
 * Soumet un ou plusieurs packs Whisper à RunPod pour analyser des assets en lot.
 * 1 RunPod job = max 20 assets (Whisper chargé une seule fois par pack).
 *
 * Body : { assetIds: string[], language?: string, modelSize?: string }
 * Retourne : { batches: [{ batchId, assetCount, status }], skipped: string[] }
 */
export async function POST(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !canAccessMediaLibrary(userContext.effectiveUser.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id: libraryId } = await params;

  // Vérifier que la lib existe et est de type video
  const library = await prisma.mediaLibrary.findUnique({ where: { id: libraryId } });
  if (!library) {
    return NextResponse.json({ error: "Bibliothèque introuvable" }, { status: 404 });
  }
  if (library.type !== "video") {
    return NextResponse.json({ error: "L'autocut est réservé aux bibliothèques vidéo" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const assetIds = Array.isArray(body.assetIds) ? (body.assetIds as string[]) : [];
  if (assetIds.length === 0) {
    return NextResponse.json({ error: "assetIds requis (tableau non vide)" }, { status: 400 });
  }

  const language = typeof body.language === "string" ? body.language : "fr";
  const modelSize = typeof body.modelSize === "string" ? body.modelSize : "large-v3-turbo";

  // ── Sécurité : vérifier que tous les assetIds appartiennent à cette lib et ne sont pas désactivés ──
  const validAssets = await prisma.mediaAsset.findMany({
    where: { id: { in: assetIds }, libraryId, disabled: false },
    select: { id: true, url: true },
  });
  if (validAssets.length !== assetIds.length) {
    return NextResponse.json(
      { error: "Certains assets n'appartiennent pas à cette bibliothèque ou sont désactivés" },
      { status: 403 }
    );
  }

  // ── Filtrer les assets ayant déjà un job actif ────────────────────────────
  // Un job est considéré actif seulement s'il a été mis à jour dans les 2 dernières heures.
  // Au-delà, on considère que le webhook a été perdu et on autorise la re-soumission.
  const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000;
  const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS);
  const activeJobs = await prisma.mediaAutocutJob.findMany({
    where: {
      assetId: { in: assetIds },
      status: { in: ["pending", "processing"] },
      updatedAt: { gt: staleThreshold },
    },
    select: { assetId: true },
  });
  const busyIds = new Set(activeJobs.map((j) => j.assetId));
  const toProcess = validAssets.filter((a) => !busyIds.has(a.id));
  const skipped = assetIds.filter((id) => busyIds.has(id));

  if (toProcess.length === 0) {
    return NextResponse.json({
      batches: [],
      skipped,
      message: "Tous les assets sélectionnés ont déjà un job en cours",
    });
  }

  // ── Découper en packs et soumettre ───────────────────────────────────────
  const batches: Array<{ batchId: string; assetCount: number; status: string }> = [];

  for (let i = 0; i < toProcess.length; i += PACK_SIZE) {
    const pack = toProcess.slice(i, i + PACK_SIZE);

    // Créer le batch + les jobs dans une transaction
    const { batch, jobs } = await prisma.$transaction(async (tx) => {
      const b = await tx.mediaAutocutBatch.create({
        data: {
          libraryId,
          status: "pending",
          totalCount: pack.length,
        },
      });
      const js = await Promise.all(
        pack.map((asset) =>
          tx.mediaAutocutJob.create({
            data: {
              assetId: asset.id,
              libraryId,
              batchId: b.id,
              status: "pending",
              reviewStatus: "pending_review",
            },
          })
        )
      );
      return { batch: b, jobs: js };
    });

    // Soumettre à RunPod
    if (!runpodConfigured()) {
      console.warn(`[autocut-packs] RunPod non configuré — batch ${batch.id} en pending`);
      batches.push({ batchId: batch.id, assetCount: pack.length, status: "pending" });
      continue;
    }

    try {
      const webhookUrl = getRunpodWebhookUrl("/api/webhooks/runpod/media-autocut");
      if (!webhookUrl) {
        console.error(
          `[autocut-packs] NEXTAUTH_URL non défini — batch ${batch.id} soumis sans webhook. ` +
          "Les jobs resteront bloqués en processing. Configurer NEXTAUTH_URL."
        );
      }
      const runpodResp = await submitRunpodJob<{ id: string }>(
        RUNPOD_ENDPOINT_ID,
        RUNPOD_API_KEY,
        {
          input: {
            job_type: "media_autocut_batch",
            batch_id: batch.id,
            language,
            model_size: modelSize,
            assets: pack.map((asset, idx) => ({
              job_id: jobs[idx].id,
              asset_url: asset.url,
            })),
          },
          ...(webhookUrl ? { webhook: webhookUrl } : {}),
        }
      );

      await prisma.$transaction(async (tx) => {
        await tx.mediaAutocutBatch.update({
          where: { id: batch.id },
          data: { status: "processing", runpodId: runpodResp.id },
        });
        await tx.mediaAutocutJob.updateMany({
          where: { batchId: batch.id },
          data: { status: "processing" },
        });
      });

      batches.push({ batchId: batch.id, assetCount: pack.length, status: "processing" });
    } catch (err) {
      console.error(`[autocut-packs] RunPod submit failed for batch ${batch.id}:`, err);
      await prisma.mediaAutocutBatch.update({
        where: { id: batch.id },
        data: { status: "failed", errorMsg: String(err) },
      });
      await prisma.mediaAutocutJob.updateMany({
        where: { batchId: batch.id },
        data: { status: "failed", errorMsg: "Échec soumission RunPod" },
      });
      batches.push({ batchId: batch.id, assetCount: pack.length, status: "failed" });
    }
  }

  return NextResponse.json({ batches, skipped });
}
