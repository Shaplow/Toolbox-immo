import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * PATCH /api/caption-presets/[id]
 * Admin only — can update name and isBuiltin flag.
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
  const body = await req.json() as { name?: string; isBuiltin?: boolean };

  const preset = await prisma.captionPreset.findUnique({ where: { id } });
  if (!preset) {
    return NextResponse.json({ error: "Preset introuvable" }, { status: 404 });
  }

  const updated = await prisma.captionPreset.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.isBuiltin !== undefined ? { isBuiltin: body.isBuiltin } : {}),
    },
  });

  return NextResponse.json({
    id: updated.id,
    name: updated.name,
    isBuiltin: updated.isBuiltin,
    createdAt: updated.createdAt.toISOString(),
  });
}

/**
 * DELETE /api/caption-presets/[id]
 * Supprime un preset.
 * - Admin: peut supprimer n'importe quel preset (y compris builtin).
 * - User: uniquement ses propres presets non-builtin.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const { id } = await params;
  const preset = await prisma.captionPreset.findUnique({ where: { id } });

  if (!preset) {
    return NextResponse.json({ error: "Preset introuvable" }, { status: 404 });
  }

  const isAdmin = session.user.role === "ADMIN";
  if (!isAdmin) {
    if (preset.isBuiltin) {
      return NextResponse.json({ error: "Impossible de supprimer un preset builtin" }, { status: 403 });
    }
    if (preset.userId !== session.user.id) {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }
  }

  await prisma.captionPreset.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

