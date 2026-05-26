/**
 * GET /api/description/jobs
 *
 * Retourne l'historique des DescriptionJobs de l'utilisateur courant.
 * Admin : retourne tous les jobs.
 */

import { NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const jobs = await prisma.descriptionJob.findMany({
    where: userContext.canAdminBypass ? {} : { userId: userContext.effectiveUser.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      prompt: { select: { name: true } },
      user: { select: { name: true, email: true } },
    },
  });

  return NextResponse.json(jobs);
}
