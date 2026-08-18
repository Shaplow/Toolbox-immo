/**
 * POST /api/admin/accounts/[id]/recipes — crée une recette pour ce compte.
 *
 * Wrapper atomique sur PatternTemplate + PatternBinding : permet à l'UI
 * fiche compte (G.1) d'envoyer une seule requête avec template + binding
 * et de tout créer en transaction. Si une partie échoue, rien n'est créé.
 *
 * Body :
 *   {
 *     template: { label, source, templateId?, captionPresetId?, ... },
 *     binding:  { publishTime, dayOfWeek, isActive, defaultAssignee*Id, ... }
 *   }
 *
 * Si l'UI veut réutiliser une recette existante (catalogue), elle peut
 * passer `template: { id: "..." }` au lieu d'un body de création complet —
 * dans ce cas seul le binding est créé.
 *
 * Admin-only.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import {
  validatePatternTemplateInput,
  toPatternTemplateCreateData,
  type PatternTemplateInputPayload,
} from "@/lib/services/pattern/patternTemplateInput";
import {
  validateBindingInput,
  toPatternBindingCreateData,
  type PatternBindingInputPayload,
} from "@/lib/services/pattern/bindingInput";

interface TemplatePayload extends PatternTemplateInputPayload {
  id?: string; // si fourni : réutilise (skip création template)
}

type BindingPayload = PatternBindingInputPayload;

interface CreateRecipeBody {
  template?: TemplatePayload;
  binding?: BindingPayload;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const ctx = auth.ctx;
  const { id: accountId } = await params;

  let body: CreateRecipeBody;
  try {
    body = (await req.json()) as CreateRecipeBody;
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  const tpl = body.template ?? {};
  const bnd = body.binding ?? {};

  const isReusing = !!tpl.id;
  const tplErr = isReusing
    ? null
    : await validatePatternTemplateInput(tpl, { requireAll: true, fieldPrefix: "template." }, prisma);
  if (tplErr) return NextResponse.json({ error: tplErr }, { status: 400 });

  const bndErr = validateBindingInput(bnd, { requireAll: true, fieldPrefix: "binding." });
  if (bndErr) return NextResponse.json({ error: bndErr }, { status: 400 });

  const account = await prisma.instagramAccount.findUnique({ where: { id: accountId } });
  if (!account) {
    return NextResponse.json({ error: "Compte introuvable" }, { status: 404 });
  }

  if (isReusing) {
    const existing = await prisma.patternTemplate.findUnique({ where: { id: tpl.id! } });
    if (!existing) {
      return NextResponse.json({ error: "Recette introuvable" }, { status: 404 });
    }
    if (existing.isArchived) {
      return NextResponse.json(
        { error: "Recette archivée — impossible de créer une nouvelle application." },
        { status: 400 },
      );
    }
  }

  // Transaction : template (si création) + binding ensemble.
  // Si l'un échoue, Prisma rollback l'ensemble.
  const result = await prisma.$transaction(async (tx) => {
    const templateId = isReusing
      ? tpl.id!
      : (
          await tx.patternTemplate.create({
            data: toPatternTemplateCreateData(tpl, ctx.actualUser.id),
          })
        ).id;

    const binding = await tx.patternBinding.create({
      data: toPatternBindingCreateData(bnd, { accountId, patternTemplateId: templateId }),
      include: { patternTemplate: true },
    });

    return binding;
  });

  return NextResponse.json(result, { status: 201 });
}
