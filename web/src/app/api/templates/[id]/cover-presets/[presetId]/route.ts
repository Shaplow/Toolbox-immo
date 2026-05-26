/**
 * GET    /api/templates/[id]/cover-presets/[presetId] — détail d'un preset
 * PATCH  /api/templates/[id]/cover-presets/[presetId] — mise à jour (ADMIN)
 * DELETE /api/templates/[id]/cover-presets/[presetId] — suppression (ADMIN, refusé si patterns référencent)
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

type Params = { params: Promise<{ id: string; presetId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id: templateId, presetId } = await params;

  const preset = await prisma.templateCoverPreset.findFirst({
    where: { id: presetId, templateId },
  });

  if (!preset) {
    return NextResponse.json({ error: "Preset introuvable" }, { status: 404 });
  }

  // Non-admin : vérifier l'accès au template
  if (!userContext.canAdminBypass) {
    const access = await prisma.templateAccess.findFirst({
      where: { templateId, userId: userContext.effectiveUser.id },
      select: { id: true },
    });
    if (!access) {
      return NextResponse.json({ error: "Preset introuvable" }, { status: 404 });
    }
  }

  return NextResponse.json(preset);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id: templateId, presetId } = await params;

  const existing = await prisma.templateCoverPreset.findFirst({
    where: { id: presetId, templateId },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Preset introuvable" }, { status: 404 });
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

  if (name !== undefined && (typeof name !== "string" || !name.trim())) {
    return NextResponse.json({ error: "Le champ name ne peut pas être vide" }, { status: 400 });
  }
  if (config !== undefined && (typeof config !== "object" || config === null || Array.isArray(config))) {
    return NextResponse.json({ error: "Le champ config doit être un objet JSON" }, { status: 400 });
  }
  if (sortOrder !== undefined && (!Number.isInteger(sortOrder) || typeof sortOrder !== "number")) {
    return NextResponse.json({ error: "Le champ sortOrder doit être un entier" }, { status: 400 });
  }

  const data: Prisma.TemplateCoverPresetUpdateInput = {};
  if (name !== undefined) data.name = (name as string).trim();
  if (config !== undefined) data.config = config as Prisma.InputJsonValue;
  if (sortOrder !== undefined) data.sortOrder = sortOrder as number;

  try {
    const preset = await prisma.templateCoverPreset.update({
      where: { id: presetId },
      data,
    });
    return NextResponse.json(preset);
  } catch (err: unknown) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return NextResponse.json(
        { error: `Un preset avec ce nom existe déjà pour ce template` },
        { status: 409 }
      );
    }
    console.error("[cover-presets/[presetId]] PATCH error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id: templateId, presetId } = await params;

  const preset = await prisma.templateCoverPreset.findFirst({
    where: { id: presetId, templateId },
    select: { id: true, name: true },
  });
  if (!preset) {
    return NextResponse.json({ error: "Preset introuvable" }, { status: 404 });
  }

  // Compter les patterns qui référencent ce preset par nom via JSON path
  const referencingPatterns = await prisma.accountPattern.findMany({
    where: {
      templateId,
      coverConfig: {
        path: ["coverPresetName"],
        equals: preset.name,
      },
    },
    select: { id: true, label: true, accountId: true },
  });

  if (referencingPatterns.length > 0) {
    return NextResponse.json(
      {
        error: `${referencingPatterns.length} pattern${referencingPatterns.length > 1 ? "s" : ""} référencent ce preset. Réassignez-les d'abord.`,
        count: referencingPatterns.length,
        patterns: referencingPatterns,
      },
      { status: 400 }
    );
  }

  await prisma.templateCoverPreset.delete({ where: { id: presetId } });
  return new NextResponse(null, { status: 204 });
}
