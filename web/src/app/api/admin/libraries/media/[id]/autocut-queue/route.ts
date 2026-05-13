import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function adminOnly(role?: string) {
  return role !== "ADMIN";
}

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
  const session = await auth();
  if (!session?.user?.id || adminOnly(session.user.role)) {
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
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") ?? "20", 10)));

  const where: Record<string, unknown> = { libraryId };
  if (reviewStatusFilter) where.reviewStatus = reviewStatusFilter;
  if (statusFilter) where.status = statusFilter;

  const [total, jobs] = await Promise.all([
    prisma.mediaAutocutJob.count({ where }),
    prisma.mediaAutocutJob.findMany({
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
