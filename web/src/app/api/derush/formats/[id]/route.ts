/**
 * PATCH  /api/derush/formats/[id]  — modifie un format (interdit sur les builtins sauf admin)
 * DELETE /api/derush/formats/[id]  — supprime un format (interdit sur les builtins sauf admin)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await params;

  const format = await prisma.derushFormat.findUnique({ where: { id } });
  if (!format) return NextResponse.json({ error: "Format introuvable" }, { status: 404 });

  if (format.isBuiltin && session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Les formats builtins ne peuvent pas être modifiés" }, { status: 403 });
  }
  if (!format.isBuiltin && format.userId !== session.user.id && session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  let body: {
    name?: string;
    description?: string;
    contextPrompt?: string;
    silenceThreshold?: number;
    exportMode?: string;
  };
  try {
    body = await req.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim().length >= 2) {
    data.name = body.name.trim();
  }
  if (typeof body.description === "string") {
    data.description = body.description.trim();
  }
  if (typeof body.contextPrompt === "string") {
    data.contextPrompt = body.contextPrompt.trim();
  }
  if (typeof body.silenceThreshold === "number" && body.silenceThreshold >= 0) {
    data.silenceThreshold = body.silenceThreshold;
  }
  if (body.exportMode === "individual" || body.exportMode === "qa_pair") {
    data.exportMode = body.exportMode;
  }

  const updated = await prisma.derushFormat.update({ where: { id }, data });
  return NextResponse.json(updated);
}

// ─────────────────────────────────────────────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await params;

  const format = await prisma.derushFormat.findUnique({ where: { id } });
  if (!format) return NextResponse.json({ error: "Format introuvable" }, { status: 404 });

  if (format.isBuiltin && session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Les formats builtins ne peuvent pas être supprimés" }, { status: 403 });
  }
  if (!format.isBuiltin && format.userId !== session.user.id && session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  await prisma.derushFormat.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
