import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non authentifie" }, { status: 401 });
  }
  if (!userContext.canAdminBypass) {
    return NextResponse.json({ error: "Reserve aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;

  const source = await prisma.captionPreset.findUnique({ where: { id } });
  if (!source) {
    return NextResponse.json({ error: "Preset introuvable" }, { status: 404 });
  }

  const copy = await prisma.captionPreset.create({
    data: {
      name: `Copie de ${source.name}`,
      userId: userContext.effectiveUser.id,
      isBuiltin: false,
      config: source.config,
    },
  });

  return NextResponse.json({
    id: copy.id,
    name: copy.name,
    isBuiltin: copy.isBuiltin,
    createdAt: copy.createdAt.toISOString(),
  }, { status: 201 });
}