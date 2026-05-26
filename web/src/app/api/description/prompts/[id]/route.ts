/**
 * PATCH  /api/description/prompts/[id]  — modifier un prompt (admin uniquement)
 * DELETE /api/description/prompts/[id]  — supprimer un prompt (admin uniquement)
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

async function requireAdmin() {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return { error: NextResponse.json({ error: "Non authentifié" }, { status: 401 }) };
  }
  if (!userContext.canAdminBypass) {
    return { error: NextResponse.json({ error: "Accès refusé" }, { status: 403 }) };
  }
  return { userContext };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAdmin();
  if (authResult.error) return authResult.error;

  const { id } = await params;
  const body = await req.json() as { name?: string; prompt?: string; isActive?: boolean };

  const existing = await prisma.descriptionPrompt.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Prompt introuvable" }, { status: 404 });
  }

  const updated = await prisma.descriptionPrompt.update({
    where: { id },
    data: {
      ...(body.name !== undefined && { name: body.name.trim() }),
      ...(body.prompt !== undefined && { prompt: body.prompt.trim() }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAdmin();
  if (authResult.error) return authResult.error;

  const { id } = await params;
  await prisma.descriptionPrompt.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
