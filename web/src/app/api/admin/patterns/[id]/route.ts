/**
 * GET /api/admin/patterns/[id] — détail d'un PatternTemplate + bindings liés.
 * PATCH /api/admin/patterns/[id] — édite la recette globale (propage aux
 *   bindings sans override lors des prochaines créations slots).
 * DELETE /api/admin/patterns/[id] — archive (soft) le template ; les bindings
 *   existants restent valides.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import {
  validatePatternTemplateInput,
  toPatternTemplateUpdateData,
  type PatternTemplateInputPayload,
} from "@/lib/services/pattern/patternTemplateInput";

type PatchBody = PatternTemplateInputPayload;

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const ctx = auth.ctx;
  const { id } = await params;
  const template = await prisma.patternTemplate.findUnique({
    where: { id },
    include: {
      bindings: {
        include: {
          account: { select: { id: true, name: true, handle: true } },
        },
        orderBy: [{ accountId: "asc" }, { publishTime: "asc" }],
      },
      updatedBy: { select: { id: true, name: true } },
    },
  });
  if (!template) {
    return NextResponse.json({ error: "Recette introuvable" }, { status: 404 });
  }
  return NextResponse.json(template);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const ctx = auth.ctx;
  const { id } = await params;
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  const err = await validatePatternTemplateInput(body, { requireAll: false }, prisma);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  const updated = await prisma.patternTemplate.update({
    where: { id },
    // Sprint D — audit log light : trace l'auteur de l'édition.
    data: toPatternTemplateUpdateData(body, ctx.actualUser.id),
  });
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const ctx = auth.ctx;
  const { id } = await params;

  // Garde-fou : une recette encore liée à des comptes reste résolvable pour
  // les slots existants mais devient impossible à ré-appliquer/déployer une
  // fois archivée — on bloque l'archivage tant qu'il reste des bindings.
  const bindingCount = await prisma.patternBinding.count({ where: { patternTemplateId: id } });
  if (bindingCount > 0) {
    return NextResponse.json(
      {
        error: `Cette recette est utilisée par ${bindingCount} compte${bindingCount > 1 ? "s" : ""}. Retire-la des comptes avant d'archiver.`,
      },
      { status: 400 },
    );
  }

  // Même garde pour les modèles de commande actifs : une recette archivée
  // ferait échouer l'instanciation des prochaines commandes du modèle.
  const orderTemplateCount = await prisma.orderTemplateRecipe.count({
    where: { patternTemplateId: id, orderTemplate: { isArchived: false } },
  });
  if (orderTemplateCount > 0) {
    return NextResponse.json(
      {
        error: `Cette recette est utilisée par ${orderTemplateCount} modèle${orderTemplateCount > 1 ? "s" : ""} de commande. Retire-la des modèles avant d'archiver.`,
      },
      { status: 400 },
    );
  }

  // Soft-delete via isArchived. Les bindings + slots historiques restent
  // fonctionnels mais le template disparaît du catalogue.
  const archived = await prisma.patternTemplate.update({
    where: { id },
    data: { isArchived: true },
  });
  return NextResponse.json({ archived: true, id: archived.id });
}
