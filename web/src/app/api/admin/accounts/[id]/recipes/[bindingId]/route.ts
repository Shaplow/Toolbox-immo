/**
 * PATCH /api/admin/accounts/[id]/recipes/[bindingId] — édite une recette
 * appliquée à un compte (template + binding ensemble).
 *
 * Wrapper atomique sur PatternTemplate + PatternBinding. Si `template` est
 * fourni dans le body, le PatternTemplate est mis à jour ; sinon seul le
 * binding est touché. La mise à jour de template impacte tous les comptes
 * qui réutilisent la même recette — l'UI doit prévenir l'admin avant.
 *
 * DELETE /api/admin/accounts/[id]/recipes/[bindingId] — retire la recette du
 * compte (delete du binding, le template global reste intact pour les autres
 * comptes qui l'utilisent).
 *
 * Admin-only.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import {
  validatePatternTemplateInput,
  toPatternTemplateUpdateData,
  type PatternTemplateInputPayload,
} from "@/lib/services/pattern/patternTemplateInput";
import {
  validateBindingInput,
  toPatternBindingUpdateData,
  type PatternBindingInputPayload,
} from "@/lib/services/pattern/bindingInput";

type TemplatePatch = PatternTemplateInputPayload;

type BindingPatch = PatternBindingInputPayload;

interface PatchBody {
  template?: TemplatePatch;
  binding?: BindingPatch;
}

interface Params {
  params: Promise<{ id: string; bindingId: string }>;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const ctx = auth.ctx;
  const { id: accountId, bindingId } = await params;

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  const tpl = body.template;
  const bnd = body.binding ?? {};

  if (tpl) {
    const err = await validatePatternTemplateInput(tpl, { requireAll: false, fieldPrefix: "template." }, prisma);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  }
  const bndErr = validateBindingInput(bnd, { requireAll: false, fieldPrefix: "binding." });
  if (bndErr) return NextResponse.json({ error: bndErr }, { status: 400 });

  const binding = await prisma.patternBinding.findUnique({
    where: { id: bindingId },
    include: { patternTemplate: true },
  });
  if (!binding || binding.accountId !== accountId) {
    return NextResponse.json({ error: "Application introuvable" }, { status: 404 });
  }

  const result = await prisma.$transaction(async (tx) => {
    if (tpl) {
      await tx.patternTemplate.update({
        where: { id: binding.patternTemplateId },
        data: toPatternTemplateUpdateData(tpl, ctx.actualUser.id),
      });
    }

    const updated = await tx.patternBinding.update({
      where: { id: bindingId },
      data: toPatternBindingUpdateData(bnd),
      include: { patternTemplate: true },
    });
    return updated;
  });

  return NextResponse.json(result);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const { id: accountId, bindingId } = await params;
  const binding = await prisma.patternBinding.findUnique({ where: { id: bindingId } });
  if (!binding || binding.accountId !== accountId) {
    return NextResponse.json({ error: "Application introuvable" }, { status: 404 });
  }
  await prisma.patternBinding.delete({ where: { id: bindingId } });
  return NextResponse.json({ ok: true });
}
