import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { submitRunpodJob, runpodConfigured } from "@/lib/runpod";
import { getRunpodWebhookUrl } from "@/lib/webhooks/runpod";

function adminOnly(role?: string) {
  return role !== "ADMIN";
}

type Params = { params: Promise<{ id: string }> };

const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY ?? "";
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID ?? "";

/**
 * POST /api/admin/libraries/media/[libraryId]/batch-apply
 *
 * Applique les cuts validés en créant un MediaEditJob RunPod par asset accepté.
 * Les soumissions RunPod sont faites en parallèle (Promise.allSettled).
 *
 * Body : {
 *   jobIds?     : string[]  — si omis, applique tous les "accepted" de la lib
 *   mixToMono?  : boolean   — défaut false
 *   normalize?  : boolean   — défaut false
 *   gainDb?     : number    — défaut null (pas d'ajustement de volume)
 * }
 * Retourne : { submitted: number, failed: [{ jobId, error }] }
 */
export async function POST(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id: libraryId } = await params;

  const library = await prisma.mediaLibrary.findUnique({ where: { id: libraryId } });
  if (!library) {
    return NextResponse.json({ error: "Bibliothèque introuvable" }, { status: 404 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // corps vide acceptable
  }

  const requestedIds = Array.isArray(body.jobIds) ? (body.jobIds as string[]) : null;
  const mixToMono = Boolean(body.mixToMono ?? false);
  const normalize = Boolean(body.normalize ?? false);
  const gainDbRaw = body.gainDb != null ? Number(body.gainDb) : null;
  const gainDb = gainDbRaw !== null && !isNaN(gainDbRaw)
    ? Math.max(-24, Math.min(24, gainDbRaw))
    : null;

  // Charger les jobs acceptés à appliquer
  const autocutJobs = await prisma.mediaAutocutJob.findMany({
    where: {
      libraryId,
      reviewStatus: "accepted",
      // Si jobIds fournis, filtrer — et vérifier qu'ils appartiennent à la lib (déjà via libraryId)
      ...(requestedIds ? { id: { in: requestedIds } } : {}),
      // Exclure ceux déjà en cours d'application (editJobId déjà présent)
      editJobId: null,
    },
    include: {
      asset: { select: { id: true, r2Key: true, url: true } },
    },
  });

  if (autocutJobs.length === 0) {
    return NextResponse.json({ submitted: 0, failed: [] });
  }

  const webhookUrl = runpodConfigured()
    ? getRunpodWebhookUrl("/api/webhooks/runpod/media-edit")
    : null;

  const results = await Promise.allSettled(
    autocutJobs.map(async (autocutJob) => {
      const { confirmedStart, confirmedEnd, asset } = autocutJob;

      if (confirmedStart === null || confirmedEnd === null) {
        throw new Error("confirmedStart/confirmedEnd manquants");
      }

      const editParams: Record<string, unknown> = {
        trimStart: confirmedStart,
        trimEnd: confirmedEnd,
        mixToMono,
        normalize,
        ...(gainDb !== null ? { gainDb } : {}),
      };

      // Créer le MediaEditJob + mettre à jour l'autocutJob atomiquement
      const editJob = await prisma.$transaction(async (tx) => {
        const ej = await tx.mediaEditJob.create({
          data: {
            assetId: asset.id,
            status: "pending",
            params: JSON.stringify(editParams),
          },
        });
        await tx.mediaAutocutJob.update({
          where: { id: autocutJob.id },
          data: { editJobId: ej.id, reviewStatus: "applied" },
        });
        return ej;
      });

      // Soumettre à RunPod
      if (!runpodConfigured()) {
        console.warn(`[batch-apply] RunPod non configuré — editJob ${editJob.id} en pending`);
        return { editJobId: editJob.id, autocutJobId: autocutJob.id };
      }

      try {
        const runpodResp = await submitRunpodJob<{ id: string }>(
          RUNPOD_ENDPOINT_ID,
          RUNPOD_API_KEY,
          {
            input: {
              job_type: "media_edit",
              job_id: editJob.id,
              asset_url: asset.url,
              r2_key: asset.r2Key,
              params: editParams,
            },
            webhook: webhookUrl!,
          }
        );
        await prisma.mediaEditJob.update({
          where: { id: editJob.id },
          data: { status: "processing", runpodId: runpodResp.id },
        });
      } catch (err) {
        await prisma.mediaEditJob.update({
          where: { id: editJob.id },
          data: { status: "failed", errorMsg: String(err) },
        });
        throw err;
      }

      return { editJobId: editJob.id, autocutJobId: autocutJob.id };
    })
  );

  const failed: Array<{ jobId: string; error: string }> = [];
  const editJobs: Array<{ autocutJobId: string; editJobId: string }> = [];
  let submitted = 0;

  results.forEach((result, idx) => {
    if (result.status === "fulfilled") {
      submitted++;
      if (result.value) editJobs.push(result.value);
    } else {
      failed.push({
        jobId: autocutJobs[idx].id,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  });

  return NextResponse.json({ submitted, failed, editJobs });
}
