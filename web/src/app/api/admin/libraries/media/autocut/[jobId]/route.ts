import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { canManageMediaAssets } from "@/lib/permissions/mediaLibrary";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ jobId: string }> };

/**
 * PATCH /api/admin/libraries/media/autocut/[jobId]
 *
 * Valide, ajuste ou passe un MediaAutocutJob individuel.
 *
 * Body : {
 *   reviewStatus  : "accepted" | "skipped"
 *   confirmedStart?: number
 *   confirmedEnd?  : number
 * }
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  if (!canManageMediaAssets(auth.ctx.effectiveUser.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { jobId } = await params;

  const job = await prisma.mediaAutocutJob.findUnique({
    where: { id: jobId },
  });
  if (!job) {
    return NextResponse.json({ error: "Job introuvable" }, { status: 404 });
  }

  // Empêcher de toucher un job déjà appliqué
  if (job.reviewStatus === "applied") {
    return NextResponse.json(
      { error: "Ce job a déjà été appliqué, impossible de le modifier" },
      { status: 409 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const reviewStatus = body.reviewStatus as string | undefined;
  if (!reviewStatus || !["accepted", "skipped"].includes(reviewStatus)) {
    return NextResponse.json(
      { error: "reviewStatus doit être 'accepted' ou 'skipped'" },
      { status: 400 }
    );
  }

  const confirmedStart = body.confirmedStart != null ? Number(body.confirmedStart) : undefined;
  const confirmedEnd = body.confirmedEnd != null ? Number(body.confirmedEnd) : undefined;

  if (confirmedStart !== undefined && (isNaN(confirmedStart) || confirmedStart < 0)) {
    return NextResponse.json({ error: "confirmedStart invalide" }, { status: 400 });
  }
  if (confirmedEnd !== undefined && (isNaN(confirmedEnd) || confirmedEnd <= 0)) {
    return NextResponse.json({ error: "confirmedEnd invalide" }, { status: 400 });
  }
  if (
    confirmedStart !== undefined &&
    confirmedEnd !== undefined &&
    confirmedEnd <= confirmedStart
  ) {
    return NextResponse.json(
      { error: "confirmedEnd doit être supérieur à confirmedStart" },
      { status: 400 }
    );
  }

  // Skip = suppression du job pour que l'asset redevienne sélectionnable
  if (reviewStatus === "skipped") {
    await prisma.mediaAutocutJob.delete({ where: { id: jobId } });
    return NextResponse.json({ deleted: true });
  }

  // Accepted : mettre à jour les timings confirmés
  const updateData: Record<string, unknown> = { reviewStatus };
  if (confirmedStart !== undefined) updateData.confirmedStart = confirmedStart;
  if (confirmedEnd !== undefined) updateData.confirmedEnd = confirmedEnd;

  // Fallback sur les valeurs proposées si non fournies
  if (updateData.confirmedStart === undefined) {
    updateData.confirmedStart = job.confirmedStart ?? job.proposedStart;
  }
  if (updateData.confirmedEnd === undefined) {
    updateData.confirmedEnd = job.confirmedEnd ?? job.proposedEnd;
  }

  // Guard explicite : un accept sans timings exploitables (Whisper failed,
  // job processing pas encore parvenu) générait un job "accepted" sans
  // confirmedStart/End → batch-apply throw silencieusement plus tard sans
  // remonter l'erreur à l'admin (finding library-6).
  if (
    updateData.confirmedStart === null ||
    updateData.confirmedStart === undefined ||
    updateData.confirmedEnd === null ||
    updateData.confirmedEnd === undefined
  ) {
    return NextResponse.json(
      {
        error:
          "Impossible d'accepter ce job : confirmedStart/confirmedEnd manquants (proposedStart/End nuls — Whisper n'a rien trouvé ou job encore en traitement).",
      },
      { status: 400 },
    );
  }

  const updated = await prisma.mediaAutocutJob.update({
    where: { id: jobId },
    data: updateData,
  });

  return NextResponse.json(updated);
}
