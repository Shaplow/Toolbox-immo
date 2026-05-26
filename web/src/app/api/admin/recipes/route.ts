import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

const VALID_SOURCES = ["auto_template", "manual_rushes", "external_upload"] as const;
const VALID_NEEDS_DESCRIPTION = ["preFilled", "autoGenerate", "manualWrite", "none"] as const;
const VALID_NEEDS_COVER = ["auto", "manualSelect", "none"] as const;

// GET /api/admin/recipes — liste toutes les ContentRecipe
export async function GET(_req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx || ctx.actualUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const recipes = await prisma.contentRecipe.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      template: { select: { id: true, name: true, contentType: true } },
      library: { select: { id: true, name: true } },
      defaultAssigneeMonteur: { select: { name: true } },
      defaultAssigneeCm: { select: { name: true } },
      _count: { select: { publicationSlots: true } },
    },
  });

  return NextResponse.json(recipes);
}

// POST /api/admin/recipes — création manuelle d'une ContentRecipe
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx || ctx.actualUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

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

  // Validation obligatoire
  if (!code || typeof code !== "string" || code.trim() === "") {
    return NextResponse.json({ error: "Le champ 'code' est obligatoire" }, { status: 400 });
  }
  if (!label || typeof label !== "string" || label.trim() === "") {
    return NextResponse.json({ error: "Le champ 'label' est obligatoire" }, { status: 400 });
  }
  if (!source || !VALID_SOURCES.includes(source)) {
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

  try {
    const recipe = await prisma.contentRecipe.create({
      data: {
        code: code.trim(),
        label: label.trim(),
        source,
        templateId: templateId ?? null,
        libraryId: libraryId ?? null,
        needsDescription: needsDescription ?? "none",
        needsCover: needsCover ?? "none",
        needsCaptions: needsCaptions ?? false,
        needsClientValidation: needsClientValidation ?? false,
        needsRushes: needsRushes ?? false,
        needsBrief: needsBrief ?? false,
        defaultAssigneeMonteurId: defaultAssigneeMonteurId ?? null,
        defaultAssigneeCmId: defaultAssigneeCmId ?? null,
        notes: notes ?? null,
      },
      include: {
        template: { select: { id: true, name: true, contentType: true } },
        library: { select: { id: true, name: true } },
        defaultAssigneeMonteur: { select: { name: true } },
        defaultAssigneeCm: { select: { name: true } },
        _count: { select: { publicationSlots: true } },
      },
    });
    return NextResponse.json(recipe, { status: 201 });
  } catch (err: unknown) {
    const error = err as { code?: string };
    if (error?.code === "P2002") {
      return NextResponse.json(
        { error: `Une ContentRecipe avec le code '${code}' existe déjà` },
        { status: 409 }
      );
    }
    throw err;
  }
}
