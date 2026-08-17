import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;

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