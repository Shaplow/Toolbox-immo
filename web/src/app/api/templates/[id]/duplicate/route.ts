import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

// POST /api/templates/[id]/duplicate — ADMIN seulement
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  if (!userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;

  const source = await prisma.template.findUnique({ where: { id } });
  if (!source) {
    return NextResponse.json({ error: "Template introuvable" }, { status: 404 });
  }

  const copy = await prisma.template.create({
    data: {
      name:     `Copie de ${source.name}`,
      client:   source.client,
      formats:  source.formats,
      jsonData: source.jsonData,
      userId:   userContext.effectiveUser.id,
    },
  });

  return NextResponse.json(copy, { status: 201 });
}
