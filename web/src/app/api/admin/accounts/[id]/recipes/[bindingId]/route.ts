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
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { normalizeSourceFieldKey } from "@/lib/publications/preFilledDescription";

interface TemplatePatch {
  label?: string;
  source?: string;
  templateId?: string | null;
  captionPresetId?: string | null;
  descriptionPromptId?: string | null;
  descriptionSourceFieldKey?: string | null;
  coverMode?: string;
  coverConfig?: unknown;
  needsDescription?: string;
  needsCaptionsMode?: string;
  needsAdminValidation?: boolean;
  needsClientValidation?: boolean;
  allowsClientRevision?: boolean;
  needsBrief?: boolean;
  requiresProperty?: boolean;
  notes?: string | null;
}

interface BindingPatch {
  customLabel?: string | null;
  dayOfWeek?: number[];
  publishTime?: string;
  isActive?: boolean;
  defaultAssigneeMonteurId?: string | null;
  defaultAssigneeCmId?: string | null;
  defaultAssigneeVideasteId?: string | null;
  templateIdOverride?: string | null;
  captionPresetIdOverride?: string | null;
  descriptionPromptIdOverride?: string | null;
  coverModeOverride?: string | null;
  notes?: string | null;
}

interface PatchBody {
  template?: TemplatePatch;
  binding?: BindingPatch;
}

const VALID_SOURCES = ["auto_template", "manual_rushes", "external_upload"];
const VALID_CAPTIONS_MODES = ["none", "auto", "manual"];
const VALID_DESCRIPTION_MODES = ["none", "preFilled", "autoGenerate", "manualWrite"];
const VALID_COVER_MODES = ["none", "manualSelect", "autoPack", "monteurUpload"];
const PUBLISH_TIME_RE = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;

function validateTemplate(t: TemplatePatch): string | null {
  if (t.label !== undefined && !t.label.trim()) return "template.label vide interdit";
  if (t.source !== undefined && !VALID_SOURCES.includes(t.source)) {
    return `template.source invalide (attendu : ${VALID_SOURCES.join(", ")})`;
  }
  if (t.needsCaptionsMode !== undefined && !VALID_CAPTIONS_MODES.includes(t.needsCaptionsMode)) {
    return "template.needsCaptionsMode invalide";
  }
  if (t.needsDescription !== undefined && !VALID_DESCRIPTION_MODES.includes(t.needsDescription)) {
    return "template.needsDescription invalide";
  }
  if (t.coverMode !== undefined && !VALID_COVER_MODES.includes(t.coverMode)) {
    return "template.coverMode invalide";
  }
  return null;
}

function validateBinding(b: BindingPatch): string | null {
  if (b.publishTime !== undefined && !PUBLISH_TIME_RE.test(b.publishTime)) {
    return "binding.publishTime doit être HH:MM";
  }
  if (b.dayOfWeek !== undefined) {
    if (!Array.isArray(b.dayOfWeek)) return "binding.dayOfWeek doit être un tableau";
    for (const d of b.dayOfWeek) {
      if (!Number.isInteger(d) || d < 1 || d > 7) {
        return "binding.dayOfWeek doit contenir des entiers 1-7";
      }
    }
  }
  if (
    b.coverModeOverride !== undefined &&
    b.coverModeOverride !== null &&
    !VALID_COVER_MODES.includes(b.coverModeOverride)
  ) {
    return "binding.coverModeOverride invalide";
  }
  return null;
}

interface Params {
  params: Promise<{ id: string; bindingId: string }>;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = await getUserContext();
  if (!ctx?.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }
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
    const err = validateTemplate(tpl);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  }
  const bndErr = validateBinding(bnd);
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
        data: {
          ...(tpl.label !== undefined && { label: tpl.label.trim() }),
          ...(tpl.source !== undefined && { source: tpl.source }),
          ...(tpl.templateId !== undefined && { templateId: tpl.templateId }),
          ...(tpl.captionPresetId !== undefined && { captionPresetId: tpl.captionPresetId }),
          ...(tpl.descriptionPromptId !== undefined && { descriptionPromptId: tpl.descriptionPromptId }),
          ...(tpl.descriptionSourceFieldKey !== undefined && {
            descriptionSourceFieldKey: normalizeSourceFieldKey(tpl.descriptionSourceFieldKey),
          }),
          ...(tpl.coverMode !== undefined && { coverMode: tpl.coverMode }),
          ...(tpl.coverConfig !== undefined && {
            coverConfig: tpl.coverConfig === null ? undefined : (tpl.coverConfig as object),
          }),
          ...(tpl.needsDescription !== undefined && { needsDescription: tpl.needsDescription }),
          ...(tpl.needsCaptionsMode !== undefined && {
            needsCaptionsMode: tpl.needsCaptionsMode,
            needsCaptions: tpl.needsCaptionsMode === "auto",
          }),
          ...(tpl.needsAdminValidation !== undefined && { needsAdminValidation: tpl.needsAdminValidation }),
          ...(tpl.needsClientValidation !== undefined && { needsClientValidation: tpl.needsClientValidation }),
          ...(tpl.allowsClientRevision !== undefined && { allowsClientRevision: tpl.allowsClientRevision }),
          ...(tpl.needsBrief !== undefined && { needsBrief: tpl.needsBrief }),
          ...(tpl.requiresProperty !== undefined && { requiresProperty: tpl.requiresProperty }),
          ...(tpl.notes !== undefined && { notes: tpl.notes }),
          updatedByUserId: ctx.actualUser.id,
        },
      });
    }

    const updated = await tx.patternBinding.update({
      where: { id: bindingId },
      data: {
        ...(bnd.customLabel !== undefined && { customLabel: bnd.customLabel }),
        ...(bnd.dayOfWeek !== undefined && { dayOfWeek: bnd.dayOfWeek }),
        ...(bnd.publishTime !== undefined && { publishTime: bnd.publishTime }),
        ...(bnd.isActive !== undefined && { isActive: bnd.isActive }),
        ...(bnd.defaultAssigneeMonteurId !== undefined && {
          defaultAssigneeMonteurId: bnd.defaultAssigneeMonteurId,
        }),
        ...(bnd.defaultAssigneeCmId !== undefined && { defaultAssigneeCmId: bnd.defaultAssigneeCmId }),
        ...(bnd.defaultAssigneeVideasteId !== undefined && {
          defaultAssigneeVideasteId: bnd.defaultAssigneeVideasteId,
        }),
        ...(bnd.templateIdOverride !== undefined && { templateIdOverride: bnd.templateIdOverride }),
        ...(bnd.captionPresetIdOverride !== undefined && {
          captionPresetIdOverride: bnd.captionPresetIdOverride,
        }),
        ...(bnd.descriptionPromptIdOverride !== undefined && {
          descriptionPromptIdOverride: bnd.descriptionPromptIdOverride,
        }),
        ...(bnd.coverModeOverride !== undefined && { coverModeOverride: bnd.coverModeOverride }),
        ...(bnd.notes !== undefined && { notes: bnd.notes }),
      },
      include: { patternTemplate: true },
    });
    return updated;
  });

  return NextResponse.json(result);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const ctx = await getUserContext();
  if (!ctx?.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }
  const { id: accountId, bindingId } = await params;
  const binding = await prisma.patternBinding.findUnique({ where: { id: bindingId } });
  if (!binding || binding.accountId !== accountId) {
    return NextResponse.json({ error: "Application introuvable" }, { status: 404 });
  }
  await prisma.patternBinding.delete({ where: { id: bindingId } });
  return NextResponse.json({ ok: true });
}
