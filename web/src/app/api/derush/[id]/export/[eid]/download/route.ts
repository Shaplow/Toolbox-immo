/**
 * GET /api/derush/[id]/export/[eid]/download
 *
 * Redirige vers l'URL publique R2 du fichier exporté.
 * L'export doit être COMPLETED avec un outputKey.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getR2PublicUrl } from "@/lib/r2";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; eid: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id, eid } = await params;

  const job = await prisma.derushJob.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "Job introuvable" }, { status: 404 });
  if (job.userId !== session.user.id && session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const exp = await prisma.derushExport.findUnique({ where: { id: eid } });
  if (!exp || exp.derushJobId !== id) {
    return NextResponse.json({ error: "Export introuvable" }, { status: 404 });
  }
  if (exp.status !== "COMPLETED" || !exp.outputKey) {
    return NextResponse.json({ error: "Export non disponible" }, { status: 409 });
  }

  const url = getR2PublicUrl(exp.outputKey);
  return NextResponse.redirect(url);
}
