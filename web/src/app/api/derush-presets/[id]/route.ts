import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * PATCH /api/derush-presets/[id]
 * Admin uniquement — met à jour un preset.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json() as {
    name?: string;
    isBuiltin?: boolean;
    config?: unknown;
    analysisMode?: string;
  };

  const preset = await prisma.derushPreset.findUnique({ where: { id } });
  if (!preset) {
    return NextResponse.json({ error: "Preset introuvable" }, { status: 404 });
  }

  const updated = await prisma.derushPreset.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.isBuiltin !== undefined ? { isBuiltin: body.isBuiltin } : {}),
      ...(body.config !== undefined ? { config: JSON.stringify(body.config) } : {}),
      ...(body.analysisMode !== undefined ? { analysisMode: body.analysisMode } : {}),
    },
  });

  return NextResponse.json({
    id: updated.id,
    name: updated.name,
    isBuiltin: updated.isBuiltin,
    analysisMode: updated.analysisMode,
    config: JSON.parse(updated.config) as Record<string, unknown>,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  });
}

/**
 * DELETE /api/derush-presets/[id]
 * Admin : peut supprimer n'importe quel preset.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;
  const preset = await prisma.derushPreset.findUnique({ where: { id } });
  if (!preset) {
    return NextResponse.json({ error: "Preset introuvable" }, { status: 404 });
  }

  await prisma.derushPreset.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
