/**
 * GET  /api/description/prompts  — liste les prompts actifs (user authentifié)
 * POST /api/description/prompts  — créer un prompt (admin uniquement)
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
type RecipeKind = (typeof VALID_RECIPES)[number];

function normalizeRecipeKind(value: unknown): RecipeKind {
  return typeof value === "string" && (VALID_RECIPES as readonly string[]).includes(value)
    ? (value as RecipeKind)
    : "transcript_only";
}

export async function GET() {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const prompts = await prisma.descriptionPrompt.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      prompt: true,
      createdAt: true,
      recipeKind: true,
      recipeConfig: true,
    },
  });

  return NextResponse.json(prompts);
}

export async function POST(req: NextRequest) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  if (!userContext.canAdminBypass) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const body = await req.json() as {
    name?: string;
    prompt?: string;
    recipeKind?: string;
    recipeConfig?: Record<string, unknown> | null;
  };
  const { name, prompt, recipeKind, recipeConfig } = body;

  if (!name?.trim() || !prompt?.trim()) {
    return NextResponse.json({ error: "Nom et prompt requis" }, { status: 400 });
  }

  const created = await prisma.descriptionPrompt.create({
    data: {
      name: name.trim(),
      prompt: prompt.trim(),
      recipeKind: normalizeRecipeKind(recipeKind),
      recipeConfig:
        recipeConfig && typeof recipeConfig === "object"
          ? (recipeConfig as Prisma.InputJsonValue)
          : Prisma.JsonNull,
    },
  });

  return NextResponse.json(created, { status: 201 });
}
