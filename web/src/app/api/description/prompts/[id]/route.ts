/**
 * PATCH  /api/description/prompts/[id]  — modifier un prompt (admin uniquement)
 * DELETE /api/description/prompts/[id]  — supprimer un prompt (admin uniquement)
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { isRecipeKind, VALID_RECIPE_KINDS } from "@/lib/llm/recipes";

// Recettes valides : source unique dans `lib/llm/recipes.ts`.

async function requireAdmin() {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return { error: NextResponse.json({ error: "Non authentifié" }, { status: 401 }) };
  }
  // Gestion globale d'une ressource admin (prompts) : on autorise l'ADMIN réel,
  // y compris pendant une session d'impersonation (auquel cas canAdminBypass=false).
  // Refuser pendant l'impersonation forcerait l'admin à sortir de sa session de
  // debug juste pour éditer un prompt, alors que ce n'est pas une décision
  // scope-utilisateur — c'est de l'admin global.
  if (userContext.actualUser.role !== "ADMIN") {
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
    !isRecipeKind(body.recipeKind)
  ) {
    return NextResponse.json(
      { error: `recipeKind invalide. Valeurs : ${VALID_RECIPE_KINDS.join(", ")}` },
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
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAdmin();
  if (authResult.error) return authResult.error;

  const { id } = await params;
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "true";

  // Avant suppression dure : check si le prompt est référencé par des patterns
  // ou des slots. Sinon le SetNull en cascade casse silencieusement la chaîne
  // de production (pattern qui pointait vers ce prompt fall back vers "aucun",
  // slots avec override perdent leur recipe). Le snapshot des historiques
  // (DescriptionJob.promptSnapshot) reste préservé, donc pas de perte pour
  // l'audit — mais les patterns/slots en cours sont silencieusement déconnectés.
  if (!force) {
    const [patterns, slots] = await Promise.all([
      prisma.accountPattern.findMany({
        where: { descriptionPromptId: id },
        select: {
          id: true,
          label: true,
          account: { select: { id: true, handle: true } },
        },
      }),
      prisma.publicationSlot.findMany({
        where: { descriptionPromptIdOverride: id },
        select: { id: true, title: true },
        take: 25,
      }),
    ]);

    if (patterns.length > 0 || slots.length > 0) {
      return NextResponse.json(
        {
          error: "Prompt utilisé",
          message:
            "Ce prompt est utilisé comme défaut par un ou plusieurs patterns ou en override sur des slots. " +
            "Désactivez-le (isActive=false) plutôt que de le supprimer, ou retirez d'abord les références. " +
            "Pour forcer la suppression, repassez la requête avec ?force=true.",
          patterns: patterns.map((p) => ({
            id: p.id,
            label: p.label,
            accountHandle: p.account?.handle ?? null,
          })),
          slots: slots.map((s) => ({ id: s.id, title: s.title })),
          counts: { patterns: patterns.length, slots: slots.length },
        },
        { status: 409 },
      );
    }
  }

  await prisma.descriptionPrompt.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
