import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/admin/libraries/media/[libraryId]/autocut-queue
 *
 * Retourne les MediaAutocutJob de la lib pour la file de review.
 * Query params :
 *   reviewStatus : "pending_review" | "accepted" | "skipped" | "applied" (défaut: tous)
 *   status       : "pending" | "processing" | "done" | "failed" (défaut: tous)
 *   page         : numéro de page (défaut: 1)
 *   pageSize     : taille de page (défaut: 20, max: 100)
 */
export async function GET(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id: libraryId } = await params;

  const library = await prisma.mediaLibrary.findUnique({ where: { id: libraryId } });
  if (!library) {
    return NextResponse.json({ error: "Bibliothèque introuvable" }, { status: 404 });
  }

  const searchParams = req.nextUrl.searchParams;
  const reviewStatusFilter = searchParams.get("reviewStatus");
  const statusFilter = searchParams.get("status");
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const pageSize = Math.min(500, Math.max(1, parseInt(searchParams.get("pageSize") ?? "20", 10)));
  // Mode lean : skip les includes asset/editJob — utile quand on ne veut que les statuts
  const lean = searchParams.get("lean") === "1";

  const where: Record<string, unknown> = { libraryId };
  if (reviewStatusFilter) where.reviewStatus = reviewStatusFilter;
  if (statusFilter) where.status = statusFilter;

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
            transcriptJson: true,
            language: true,
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
