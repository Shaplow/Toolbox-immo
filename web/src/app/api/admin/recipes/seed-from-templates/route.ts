import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// POST /api/admin/recipes/seed-from-templates — seed idempotent depuis Template.contentType distincts
export async function POST(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  // 1. Récupérer tous les contentType distincts non vides depuis Template
  const templates = await prisma.template.findMany({
    where: { contentType: { not: "" } },
    select: { id: true, contentType: true },
    orderBy: { createdAt: "asc" },
  });

  // Grouper par contentType : premier template trouvé, et détecter les ambiguïtés
  const groupByContentType = new Map<string, { firstId: string; count: number }>();
  for (const tpl of templates) {
    const existing = groupByContentType.get(tpl.contentType);
    if (!existing) {
      groupByContentType.set(tpl.contentType, { firstId: tpl.id, count: 1 });
    } else {
      existing.count += 1;
    }
  }

  // 2. Récupérer les codes de ContentRecipe déjà existants
  const existingRecipes = await prisma.contentRecipe.findMany({
    select: { code: true },
  });
  const existingCodes = new Set(existingRecipes.map((r) => r.code));

  // 3. Pour chaque contentType, créer si absent
  const created: { code: string; id: string; templateId: string | null; ambiguous: boolean }[] = [];
  const skipped: string[] = [];

  for (const [contentType, { firstId, count }] of groupByContentType) {
    if (existingCodes.has(contentType)) {
      skipped.push(contentType);
      continue;
    }

    // templateId = premier template si unique, null si ambigu (plusieurs templates pour ce contentType)
    const isAmbiguous = count > 1;
    const templateId = isAmbiguous ? null : firstId;

    const recipe = await prisma.contentRecipe.create({
      data: {
        code: contentType,
        label: contentType,
        source: "auto_template",
        templateId,
        needsDescription: "none",
        needsCover: "none",
        needsCaptions: false,
        needsClientValidation: false,
      },
      select: { id: true, code: true, templateId: true },
    });

    created.push({
      code: recipe.code,
      id: recipe.id,
      templateId: recipe.templateId,
      ambiguous: isAmbiguous,
    });
  }

  return NextResponse.json({ created, skipped });
}
