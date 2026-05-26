/**
 * GET  /api/templates/[id]/cover-presets — liste les presets cover du template
 * POST /api/templates/[id]/cover-presets — crée un preset (ADMIN seulement)
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id: templateId } = await params;

  // Vérifier que le template existe (et que l'user y a accès — admin voit tout)
  if (userContext.canAdminBypass) {
    const template = await prisma.template.findUnique({
      where: { id: templateId },
      select: { id: true },
    });
    if (!template) {
      return NextResponse.json({ error: "Template introuvable" }, { status: 404 });
    }
  } else {
    // Non-admin : vérifier l'accès via TemplateAccess
    const access = await prisma.templateAccess.findFirst({
      where: { templateId, userId: userContext.effectiveUser.id },
      select: { id: true },
    });
    if (!access) {
      return NextResponse.json({ error: "Template introuvable" }, { status: 404 });
    }
  }

  const presets = await prisma.templateCoverPreset.findMany({
    where: { templateId },
    orderBy: { sortOrder: "asc" },
  });

  return NextResponse.json(presets);
}

export async function POST(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id: templateId } = await params;

  const template = await prisma.template.findUnique({
    where: { id: templateId },
    select: { id: true },
  });
  if (!template) {
    return NextResponse.json({ error: "Template introuvable" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const { name, config, sortOrder } = body as {
    name?: unknown;
    config?: unknown;
    sortOrder?: unknown;
  };

  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Le champ name est requis" }, { status: 400 });
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return NextResponse.json({ error: "Le champ config doit être un objet JSON" }, { status: 400 });
  }

  const resolvedSortOrder =
    typeof sortOrder === "number" && Number.isInteger(sortOrder) ? sortOrder : 0;

  try {
    const preset = await prisma.templateCoverPreset.create({
      data: {
        templateId,
        name: name.trim(),
        config: config as Prisma.InputJsonValue,
        sortOrder: resolvedSortOrder,
      },
    });
    return NextResponse.json(preset, { status: 201 });
  } catch (err: unknown) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return NextResponse.json(
        { error: `Un preset nommé "${name.trim()}" existe déjà pour ce template` },
        { status: 409 }
      );
    }
    console.error("[cover-presets] POST error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
