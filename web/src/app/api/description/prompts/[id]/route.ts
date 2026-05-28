/**
 * PATCH  /api/description/prompts/[id]  — modifier un prompt (admin uniquement)
 * DELETE /api/description/prompts/[id]  — supprimer un prompt (admin uniquement)
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

const VALID_RECIPES = [
  "transcript_only",
  "transcript_and_frame",
  "transcript_multi_frame",
  "two_pass_reformulate",
  "context_enriched",
] as const;

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
  const body = await req.json() as {
    name?: string;
    prompt?: string;
    isActive?: boolean;
    recipeKind?: string;
    recipeConfig?: Record<string, unknown> | null;
  };

  const existing = await prisma.descriptionPrompt.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Prompt introuvable" }, { status: 404 });
  }

  if (
    body.recipeKind !== undefined &&
    !(VALID_RECIPES as readonly string[]).includes(body.recipeKind)
  ) {
    return NextResponse.json(
      { error: `recipeKind invalide. Valeurs : ${VALID_RECIPES.join(", ")}` },
      { status: 400 },
    );
  }

  const updated = await prisma.descriptionPrompt.update({
    where: { id },
    data: {
      ...(body.name !== undefined && { name: body.name.trim() }),
      ...(body.prompt !== undefined && { prompt: body.prompt.trim() }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
      ...(body.recipeKind !== undefined && { recipeKind: body.recipeKind }),
      ...(body.recipeConfig !== undefined && {
        recipeConfig:
          body.recipeConfig === null
            ? Prisma.JsonNull
            : (body.recipeConfig as Prisma.InputJsonValue),
      }),
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
