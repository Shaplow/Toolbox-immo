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
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import {
  normalizeSourceFieldKey,
  normalizeFixedText,
} from "@/lib/publications/preFilledDescription";

interface TemplatePayload {
  id?: string; // si fourni : réutilise (skip création template)
  label?: string;
  source?: string;
  templateId?: string | null;
  captionPresetId?: string | null;
  descriptionPromptId?: string | null;
  descriptionSourceFieldKey?: string | null;
  descriptionFixedText?: string | null;
  coverMode?: string;
  coverConfig?: unknown;
  needsDescription?: string;
  needsCaptionsMode?: string;
  needsAdminValidation?: boolean;
  needsClientValidation?: boolean;
  allowsClientRevision?: boolean;
  needsBrief?: boolean;
  requiresProperty?: boolean;
  /** Phase 5 (métaobjet) — remplace requiresProperty. */
  requiresEntityTypeId?: string | null;
  notes?: string | null;
}

interface BindingPayload {
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

interface CreateRecipeBody {
  template?: TemplatePayload;
  binding?: BindingPayload;
}

const VALID_SOURCES = ["auto_template", "manual_rushes", "external_upload"];
const VALID_CAPTIONS_MODES = ["none", "auto", "manual"];
const VALID_DESCRIPTION_MODES = ["none", "preFilled", "fixed", "autoGenerate", "manualWrite"];
const VALID_COVER_MODES = ["none", "manualSelect", "autoPack", "monteurUpload"];
const PUBLISH_TIME_RE = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;

function validateTemplate(t: TemplatePayload, isNew: boolean): string | null {
  if (isNew) {
    if (!t.label?.trim()) return "template.label requis";
    if (!t.source || !VALID_SOURCES.includes(t.source)) {
      return `template.source invalide (attendu : ${VALID_SOURCES.join(", ")})`;
    }
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

function validateBinding(b: BindingPayload, requireAll: boolean): string | null {
  if (requireAll && !b.publishTime) return "binding.publishTime requis";
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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getUserContext();
  if (!ctx?.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }
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
  const tplErr = isReusing ? null : validateTemplate(tpl, true);
  if (tplErr) return NextResponse.json({ error: tplErr }, { status: 400 });

  const bndErr = validateBinding(bnd, true);
  if (bndErr) return NextResponse.json({ error: bndErr }, { status: 400 });

  if (tpl.requiresEntityTypeId) {
    const type = await prisma.entityType.findUnique({
      where: { id: tpl.requiresEntityTypeId },
      select: { id: true },
    });
    if (!type) {
      return NextResponse.json(
        { error: "template.requiresEntityTypeId : type de fiche introuvable" },
        { status: 400 },
      );
    }
  }

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
            data: {
              label: tpl.label!.trim(),
              source: tpl.source!,
              templateId: tpl.templateId ?? null,
              captionPresetId: tpl.captionPresetId ?? null,
              descriptionPromptId: tpl.descriptionPromptId ?? null,
              descriptionSourceFieldKey: normalizeSourceFieldKey(tpl.descriptionSourceFieldKey),
              descriptionFixedText: normalizeFixedText(tpl.descriptionFixedText),
              coverMode: tpl.coverMode ?? "none",
              coverConfig:
                tpl.coverConfig === undefined || tpl.coverConfig === null
                  ? undefined
                  : (tpl.coverConfig as object),
              needsDescription: tpl.needsDescription ?? "none",
              needsCaptions: tpl.needsCaptionsMode === "auto",
              needsCaptionsMode: tpl.needsCaptionsMode ?? "none",
              needsAdminValidation: tpl.needsAdminValidation ?? false,
              needsClientValidation: tpl.needsClientValidation ?? false,
              allowsClientRevision: tpl.allowsClientRevision ?? false,
              needsBrief: tpl.needsBrief ?? false,
              requiresProperty: tpl.requiresProperty ?? false,
              requiresEntityTypeId: tpl.requiresEntityTypeId ?? null,
              notes: tpl.notes ?? null,
              updatedByUserId: ctx.actualUser.id,
            },
          })
        ).id;

    const binding = await tx.patternBinding.create({
      data: {
        accountId,
        patternTemplateId: templateId,
        customLabel: bnd.customLabel ?? null,
        dayOfWeek: bnd.dayOfWeek ?? [],
        publishTime: bnd.publishTime!,
        isActive: bnd.isActive ?? true,
        defaultAssigneeMonteurId: bnd.defaultAssigneeMonteurId ?? null,
        defaultAssigneeCmId: bnd.defaultAssigneeCmId ?? null,
        defaultAssigneeVideasteId: bnd.defaultAssigneeVideasteId ?? null,
        templateIdOverride: bnd.templateIdOverride ?? null,
        captionPresetIdOverride: bnd.captionPresetIdOverride ?? null,
        descriptionPromptIdOverride: bnd.descriptionPromptIdOverride ?? null,
        coverModeOverride: bnd.coverModeOverride ?? null,
        notes: bnd.notes ?? null,
      },
      include: { patternTemplate: true },
    });

    return binding;
  });

  return NextResponse.json(result, { status: 201 });
}
