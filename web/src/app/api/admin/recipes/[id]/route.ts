import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

const VALID_SOURCES = ["auto_template", "manual_rushes", "external_upload"] as const;
const VALID_NEEDS_DESCRIPTION = ["preFilled", "autoGenerate", "manualWrite", "none"] as const;
const VALID_NEEDS_COVER = ["auto", "manualSelect", "none"] as const;

type Params = { params: Promise<{ id: string }> };

// GET /api/admin/recipes/[id] — détail d'une ContentRecipe
export async function GET(_req: NextRequest, { params }: Params) {
  const ctx = await getUserContext();
  if (!ctx || ctx.actualUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;

  const recipe = await prisma.contentRecipe.findUnique({
    where: { id },
    include: {
      template: { select: { id: true, name: true, contentType: true } },
      library: { select: { id: true, name: true } },
      defaultAssigneeMonteur: { select: { id: true, name: true } },
      defaultAssigneeCm: { select: { id: true, name: true } },
    },
  });

  if (!recipe) {
    return NextResponse.json({ error: "ContentRecipe introuvable" }, { status: 404 });
  }

  return NextResponse.json(recipe);
}

// PATCH /api/admin/recipes/[id] — mise à jour partielle d'une ContentRecipe
export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = await getUserContext();
  if (!ctx || ctx.actualUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();

  const {
    code,
    label,
    source,
    templateId,
    libraryId,
    needsDescription,
    needsCover,
    needsCaptions,
    needsClientValidation,
    needsRushes,
    needsBrief,
    defaultAssigneeMonteurId,
    defaultAssigneeCmId,
    notes,
  } = body;

  // Validation des champs optionnels mais contraints
  if (source !== undefined && !VALID_SOURCES.includes(source)) {
    return NextResponse.json(
      { error: `'source' doit être l'une de : ${VALID_SOURCES.join(", ")}` },
      { status: 400 }
    );
  }
  if (needsDescription !== undefined && !VALID_NEEDS_DESCRIPTION.includes(needsDescription)) {
    return NextResponse.json(
      { error: `'needsDescription' doit être l'une de : ${VALID_NEEDS_DESCRIPTION.join(", ")}` },
      { status: 400 }
    );
  }
  if (needsCover !== undefined && !VALID_NEEDS_COVER.includes(needsCover)) {
    return NextResponse.json(
      { error: `'needsCover' doit être l'une de : ${VALID_NEEDS_COVER.join(", ")}` },
      { status: 400 }
    );
  }

  const data: Record<string, unknown> = {};
  if (code !== undefined) data.code = code.trim();
  if (label !== undefined) data.label = label.trim();
  if (source !== undefined) data.source = source;
  if (templateId !== undefined) data.templateId = templateId ?? null;
  if (libraryId !== undefined) data.libraryId = libraryId ?? null;
  if (needsDescription !== undefined) data.needsDescription = needsDescription;
  if (needsCover !== undefined) data.needsCover = needsCover;
  if (needsCaptions !== undefined) data.needsCaptions = needsCaptions;
  if (needsClientValidation !== undefined) data.needsClientValidation = needsClientValidation;
  if (needsRushes !== undefined) data.needsRushes = needsRushes;
  if (needsBrief !== undefined) data.needsBrief = needsBrief;
  if (defaultAssigneeMonteurId !== undefined) data.defaultAssigneeMonteurId = defaultAssigneeMonteurId ?? null;
  if (defaultAssigneeCmId !== undefined) data.defaultAssigneeCmId = defaultAssigneeCmId ?? null;
  if (notes !== undefined) data.notes = notes ?? null;

  try {
    const recipe = await prisma.contentRecipe.update({
      where: { id },
      data,
      include: {
        template: { select: { id: true, name: true, contentType: true } },
        library: { select: { id: true, name: true } },
        defaultAssigneeMonteur: { select: { id: true, name: true } },
        defaultAssigneeCm: { select: { id: true, name: true } },
      },
    });
    return NextResponse.json(recipe);
  } catch (err: unknown) {
    const error = err as { code?: string };
    if (error?.code === "P2025") {
      return NextResponse.json({ error: "ContentRecipe introuvable" }, { status: 404 });
    }
    if (error?.code === "P2002") {
      return NextResponse.json(
        { error: `Une ContentRecipe avec ce code existe déjà` },
        { status: 409 }
      );
    }
    throw err;
  }
}

// DELETE /api/admin/recipes/[id] — suppression d'une ContentRecipe
export async function DELETE(_req: NextRequest, { params }: Params) {
  const ctx = await getUserContext();
  if (!ctx || ctx.actualUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;

  try {
    await prisma.contentRecipe.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const error = err as { code?: string };
    if (error?.code === "P2025") {
      return NextResponse.json({ error: "ContentRecipe introuvable" }, { status: 404 });
    }
    throw err;
  }
}
