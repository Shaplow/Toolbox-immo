import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { canManageMediaAssets } from "@/lib/permissions/mediaLibrary";
import { prisma } from "@/lib/prisma";
import {
  AUTOCUT_JOB_STATUSES,
  AUTOCUT_REVIEW_STATUSES,
  parseCsvFilter,
  summarizeAutocutCounts,
} from "@/lib/mediaAutocut";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/admin/libraries/media/[libraryId]/autocut-queue
 *
 * Retourne les MediaAutocutJob de la lib pour la file de review.
 * Query params :
 *   reviewStatus : "pending_review" | "accepted" | "skipped" | "applied" (défaut: tous)
 *                  — liste CSV acceptée ("accepted,applied")
 *   status       : "pending" | "processing" | "done" | "failed" (défaut: tous)
 *                  — liste CSV acceptée
 *   page         : numéro de page (défaut: 1)
 *   pageSize     : taille de page (défaut: 20, max: 500)
 *   lean         : "1" — select restreint, sans includes ni transcript
 *   summary      : "1" — ne retourne QUE { counts }, via un groupBy (aucun findMany)
 *
 * Le mode summary existe parce que le badge « Analyse auto » et le titre
 * « Review — N à valider » doivent compter la MÊME chose : les jobs réellement
 * validables (done + pending_review). Compter des lignes paginées invitait à
 * filtrer sur reviewStatus seul, ce qui gonflait le badge avec les échecs.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  if (!canManageMediaAssets(auth.ctx.effectiveUser.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id: libraryId } = await params;

  const library = await prisma.mediaLibrary.findUnique({ where: { id: libraryId } });
  if (!library) {
    return NextResponse.json({ error: "Bibliothèque introuvable" }, { status: 404 });
  }

  const searchParams = req.nextUrl.searchParams;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const pageSize = Math.min(500, Math.max(1, parseInt(searchParams.get("pageSize") ?? "20", 10)));
  // Mode lean : skip les includes asset/editJob — utile quand on ne veut que les statuts
  const lean = searchParams.get("lean") === "1";

  const reviewStatuses = parseCsvFilter(searchParams.get("reviewStatus"), AUTOCUT_REVIEW_STATUSES);
  const statuses = parseCsvFilter(searchParams.get("status"), AUTOCUT_JOB_STATUSES);
  if (reviewStatuses === undefined) {
    return NextResponse.json({ error: "reviewStatus invalide" }, { status: 400 });
  }
  if (statuses === undefined) {
    return NextResponse.json({ error: "status invalide" }, { status: 400 });
  }

  const where: Record<string, unknown> = { libraryId };
  if (reviewStatuses) {
    where.reviewStatus = reviewStatuses.length === 1 ? reviewStatuses[0] : { in: reviewStatuses };
  }
  if (statuses) {
    where.status = statuses.length === 1 ? statuses[0] : { in: statuses };
  }

  // Mode summary : un seul groupBy, pas de lignes transportées.
  if (searchParams.get("summary") === "1") {
    const rows = await prisma.mediaAutocutJob.groupBy({
      by: ["status", "reviewStatus"],
      where: { libraryId },
      _count: { _all: true },
    });
    return NextResponse.json({ counts: summarizeAutocutCounts(rows) });
  }

  const [total, jobs] = await Promise.all([
    prisma.mediaAutocutJob.count({ where }),
    lean
      ? prisma.mediaAutocutJob.findMany({
          where,
          orderBy: [{ reviewStatus: "asc" }, { createdAt: "asc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true,
            assetId: true,
            status: true,
            reviewStatus: true,
            proposedStart: true,
            proposedEnd: true,
            confirmedStart: true,
            confirmedEnd: true,
            errorMsg: true,
            createdAt: true,
          },
        })
      : prisma.mediaAutocutJob.findMany({
          where,
          orderBy: [
            // pending_review d'abord, puis les autres
            { reviewStatus: "asc" },
            { createdAt: "asc" },
          ],
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            asset: {
              select: { id: true, filename: true, url: true, duration: true },
            },
            editJob: {
              select: { id: true, status: true },
            },
          },
        }),
  ]);

  return NextResponse.json({ jobs, total, page, pageSize });
}
