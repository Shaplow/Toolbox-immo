/**
 * GET /api/admin/patterns/[id]/peek — payload léger pour PatternPeekDrawer.
 *
 * Renvoie un résumé compact d'un PatternTemplate : identité, source, modes
 * captions/description/cover (déjà avec labels FR), flags workflow, nombre de
 * bindings, top 5 comptes liés, dernier éditeur. À utiliser dans le drawer
 * rapide d'aperçu — la fiche d'édition complète reste sur le drawer de
 * /admin/patterns.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";

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
    select: {
      id: true,
      label: true,
      source: true,
      coverMode: true,
      needsCaptionsMode: true,
      needsDescription: true,
      needsAdminValidation: true,
      needsClientValidation: true,
      allowsClientRevision: true,
      needsBrief: true,
      isArchived: true,
      notes: true,
      updatedAt: true,
      template: { select: { id: true, name: true } },
      captionPreset: { select: { id: true, name: true } },
      descriptionPrompt: { select: { id: true, name: true } },
      updatedBy: { select: { id: true, name: true } },
    },
  });
  if (!template) {
    return NextResponse.json({ error: "Recette introuvable" }, { status: 404 });
  }

  const [bindingCount, topBindings] = await Promise.all([
    prisma.patternBinding.count({ where: { patternTemplateId: id } }),
    prisma.patternBinding.findMany({
      where: { patternTemplateId: id },
      take: 5,
      orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        publishTime: true,
        isActive: true,
        customLabel: true,
        account: { select: { id: true, handle: true, name: true } },
      },
    }),
  ]);

  return NextResponse.json({
    id: template.id,
    label: template.label,
    source: template.source,
    isArchived: template.isArchived,
    coverMode: template.coverMode,
    needsCaptionsMode: template.needsCaptionsMode,
    needsDescription: template.needsDescription,
    flags: {
      needsBrief: template.needsBrief,
      needsAdminValidation: template.needsAdminValidation,
      needsClientValidation: template.needsClientValidation,
      allowsClientRevision: template.allowsClientRevision,
    },
    templateName: template.template?.name ?? null,
    captionPresetName: template.captionPreset?.name ?? null,
    descriptionPromptName: template.descriptionPrompt?.name ?? null,
    notes: template.notes,
    bindingCount,
    linkedAccounts: topBindings.map((b) => ({
      bindingId: b.id,
      accountId: b.account.id,
      handle: b.account.handle,
      name: b.account.name,
      publishTime: b.publishTime,
      isActive: b.isActive,
      customLabel: b.customLabel,
    })),
    updatedAt: template.updatedAt.toISOString(),
    updatedBy: template.updatedBy
      ? { name: template.updatedBy.name }
      : null,
  });
}
