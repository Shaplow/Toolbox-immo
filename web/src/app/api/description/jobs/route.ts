/**
 * GET /api/description/jobs
 *
 * Retourne l'historique des DescriptionJobs de l'utilisateur courant.
 * Admin : retourne tous les jobs.
 *
 * `?kind=` filtre par usage ("description" | "brief"). Absent ⇒ "description",
 * pour que l'outil descriptions garde exactement le même historique qu'avant
 * l'introduction du générateur de briefs.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { isPromptKind, normalizePromptKind } from "@/lib/llm/promptKind";

export async function GET(req: NextRequest) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const rawKind = new URL(req.url).searchParams.get("kind");
  if (rawKind !== null && !isPromptKind(rawKind)) {
    return NextResponse.json({ error: "Paramètre 'kind' invalide" }, { status: 400 });
  }
  const kind = normalizePromptKind(rawKind);

  const jobs = await prisma.descriptionJob.findMany({
    where: {
      kind,
      ...(userContext.canAdminBypass ? {} : { userId: userContext.effectiveUser.id }),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      prompt: { select: { name: true } },
      user: { select: { name: true, email: true } },
    },
  });

  return NextResponse.json(jobs);
}
