/**
 * GET  /api/description/prompts  — liste les prompts actifs (user authentifié)
 * POST /api/description/prompts  — créer un prompt (admin uniquement)
 *
 * Les deux acceptent `kind` ("description" | "brief"). Le défaut est
 * "description", donc l'outil descriptions et les recettes existantes ne voient
 * jamais les prompts de brief — et réciproquement.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { normalizeRecipeKind } from "@/lib/llm/recipes";
import { normalizePromptKind, isPromptKind } from "@/lib/llm/promptKind";

// Recettes et normalisation : source unique dans `lib/llm/recipes.ts`.

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;

  // `?kind=` filtre par usage. Absent ⇒ "description", pour que les appelants
  // existants (outil descriptions, DescriptionSection, admin recettes) gardent
  // exactement le même résultat qu'avant l'ajout du champ.
  const rawKind = new URL(req.url).searchParams.get("kind");
  if (rawKind !== null && !isPromptKind(rawKind)) {
    return NextResponse.json({ error: "Paramètre 'kind' invalide" }, { status: 400 });
  }
  const kind = normalizePromptKind(rawKind);

  const prompts = await prisma.descriptionPrompt.findMany({
    where: { isActive: true, kind },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      prompt: true,
      isActive: true,
      createdAt: true,
      kind: true,
      recipeKind: true,
      recipeConfig: true,
    },
  });

  return NextResponse.json(prompts);
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;
  // Ressource admin globale : on autorise l'ADMIN réel même en impersonation
  // (les prompts ne sont pas scopés au user impersonné).
  if (userContext.actualUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const body = await req.json() as {
    name?: string;
    prompt?: string;
    kind?: string;
    recipeKind?: string;
    recipeConfig?: Record<string, unknown> | null;
  };
  const { name, prompt, kind, recipeKind, recipeConfig } = body;

  if (!name?.trim() || !prompt?.trim()) {
    return NextResponse.json({ error: "Nom et prompt requis" }, { status: 400 });
  }
  if (kind !== undefined && !isPromptKind(kind)) {
    return NextResponse.json({ error: "Champ 'kind' invalide" }, { status: 400 });
  }

  const created = await prisma.descriptionPrompt.create({
    data: {
      name: name.trim(),
      prompt: prompt.trim(),
      kind: normalizePromptKind(kind),
      recipeKind: normalizeRecipeKind(recipeKind),
      recipeConfig:
        recipeConfig && typeof recipeConfig === "object"
          ? (recipeConfig as Prisma.InputJsonValue)
          : Prisma.JsonNull,
    },
  });

  return NextResponse.json(created, { status: 201 });
}
