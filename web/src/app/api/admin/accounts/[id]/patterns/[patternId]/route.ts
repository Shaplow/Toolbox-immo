/**
 * GET    /api/admin/accounts/[id]/patterns/[patternId] — détail d'un pattern
 * PATCH  /api/admin/accounts/[id]/patterns/[patternId] — mise à jour partielle
 * DELETE /api/admin/accounts/[id]/patterns/[patternId] — suppression (si 0 slots liés)
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { validatePatternCrossFields } from "@/app/api/admin/accounts/[id]/patterns/route";

const VALID_SOURCES = ["auto_template", "manual_rushes", "external_upload"] as const;
const VALID_COVER_MODES = ["auto", "manualSelect", "none"] as const;
const VALID_NEEDS_DESCRIPTION = ["preFilled", "autoGenerate", "manualWrite", "none"] as const;
const PUBLISH_TIME_RE = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;

const patternIncludes = {
  template: { select: { id: true, name: true } },
  defaultAssigneeMonteur: { select: { id: true, name: true } },
  defaultAssigneeCm: { select: { id: true, name: true } },
  defaultAssigneeVideaste: { select: { id: true, name: true } },
  _count: { select: { publicationSlots: true } },
} as const;

type PatchBody = {
  label?: string;
  source?: string;
  templateId?: string | null;
  coverMode?: string;
  coverConfig?: unknown;
  needsDescription?: string;
  needsCaptions?: boolean;
  needsClientValidation?: boolean;
  allowsClientRevision?: boolean;
  needsRushes?: boolean;
  needsBrief?: boolean;
  dayOfWeek?: number[];
  publishTime?: string;
  isActive?: boolean;
  defaultAssigneeMonteurId?: string | null;
  defaultAssigneeCmId?: string | null;
  defaultAssigneeVideasteId?: string | null;
  captionPresetId?: string | null;
  descriptionPromptId?: string | null;
  notes?: string | null;
};

function validatePatchBody(body: PatchBody): string | null {
  if (body.source !== undefined && !VALID_SOURCES.includes(body.source as (typeof VALID_SOURCES)[number])) {
    return `source invalide. Valeurs acceptées : ${VALID_SOURCES.join(", ")}`;
  }
  if (body.coverMode !== undefined && !VALID_COVER_MODES.includes(body.coverMode as (typeof VALID_COVER_MODES)[number])) {
    return `coverMode invalide. Valeurs acceptées : ${VALID_COVER_MODES.join(", ")}`;
  }
  if (body.needsDescription !== undefined && !VALID_NEEDS_DESCRIPTION.includes(body.needsDescription as (typeof VALID_NEEDS_DESCRIPTION)[number])) {
    return `needsDescription invalide. Valeurs acceptées : ${VALID_NEEDS_DESCRIPTION.join(", ")}`;
  }
  if (body.dayOfWeek !== undefined) {
    if (!Array.isArray(body.dayOfWeek)) {
      return "dayOfWeek doit être un tableau";
    }
    const validDays = body.dayOfWeek.every(
      (d: unknown) => typeof d === "number" && Number.isInteger(d) && d >= 1 && d <= 7
    );
    if (!validDays) return "Chaque jour doit être un entier entre 1 (lundi) et 7 (dimanche)";
  }
  if (body.publishTime !== undefined && !PUBLISH_TIME_RE.test(body.publishTime)) {
    return "publishTime doit être au format HH:MM";
  }
  if (body.captionPresetId !== undefined && body.captionPresetId !== null && typeof body.captionPresetId !== "string") {
    return "captionPresetId doit être une chaîne ou null";
  }
  if (body.descriptionPromptId !== undefined && body.descriptionPromptId !== null && typeof body.descriptionPromptId !== "string") {
    return "descriptionPromptId doit être une chaîne ou null";
  }
  return null;
}

type RouteParams = { params: Promise<{ id: string; patternId: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const userContext = await getUserContext();
  if (!userContext?.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id, patternId } = await params;

  const pattern = await prisma.accountPattern.findFirst({
    where: { id: patternId, accountId: id },
    include: patternIncludes,
  });

  if (!pattern) {
    return NextResponse.json({ error: "Pattern introuvable" }, { status: 404 });
  }

  return NextResponse.json(pattern);
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const userContext = await getUserContext();
  if (!userContext?.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id, patternId } = await params;

  // Charge l'existant pour : 1) vérification d'appartenance anti-énumération,
  // 2) merge avec le PATCH partiel avant validation cross-field.
  const existing = await prisma.accountPattern.findFirst({
    where: { id: patternId, accountId: id },
    select: {
      id: true,
      source: true,
      templateId: true,
      coverMode: true,
      coverConfig: true,
      needsCaptions: true,
      needsDescription: true,
      needsClientValidation: true,
      allowsClientRevision: true,
      captionPresetId: true,
      descriptionPromptId: true,
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Pattern introuvable" }, { status: 404 });
  }

  const body = await req.json() as PatchBody;
  const validationError = validatePatchBody(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  // Validation cross-field après merge body + existant (PATCH partiel)
  const merged = {
    source: body.source ?? existing.source,
    templateId: body.templateId !== undefined ? body.templateId : existing.templateId,
    coverMode: body.coverMode ?? existing.coverMode,
    coverConfig: body.coverConfig !== undefined ? body.coverConfig : existing.coverConfig,
    needsCaptions: body.needsCaptions ?? existing.needsCaptions,
    needsDescription: body.needsDescription ?? existing.needsDescription,
    needsClientValidation: body.needsClientValidation ?? existing.needsClientValidation,
    allowsClientRevision: body.allowsClientRevision ?? existing.allowsClientRevision,
    captionPresetId:
      body.captionPresetId !== undefined ? body.captionPresetId : existing.captionPresetId,
    descriptionPromptId:
      body.descriptionPromptId !== undefined ? body.descriptionPromptId : existing.descriptionPromptId,
  };
  const xfieldErrors = await validatePatternCrossFields(merged);
  if (xfieldErrors.length > 0) {
    return NextResponse.json(
      { error: "Pattern incohérent — corrigez les conflits avant de sauvegarder.", validationErrors: xfieldErrors },
      { status: 422 },
    );
  }

  const data: Prisma.AccountPatternUpdateInput = {};
  if (body.label !== undefined) data.label = body.label.trim();
  if (body.source !== undefined) data.source = body.source;
  if ("templateId" in body) data.template = body.templateId ? { connect: { id: body.templateId } } : { disconnect: true };
  if (body.coverMode !== undefined) data.coverMode = body.coverMode;
  if ("coverConfig" in body) data.coverConfig = body.coverConfig !== null && body.coverConfig !== undefined ? (body.coverConfig as Prisma.InputJsonValue) : Prisma.JsonNull;
  if (body.needsDescription !== undefined) data.needsDescription = body.needsDescription;
  if (body.needsCaptions !== undefined) data.needsCaptions = body.needsCaptions;
  if (body.needsClientValidation !== undefined) data.needsClientValidation = body.needsClientValidation;
  if (body.allowsClientRevision !== undefined) data.allowsClientRevision = body.allowsClientRevision;
  if (body.needsRushes !== undefined) data.needsRushes = body.needsRushes;
  if (body.needsBrief !== undefined) data.needsBrief = body.needsBrief;
  if (body.dayOfWeek !== undefined) data.dayOfWeek = [...new Set(body.dayOfWeek)].sort((a, b) => a - b);
  if (body.publishTime !== undefined) data.publishTime = body.publishTime;
  if (body.isActive !== undefined) data.isActive = body.isActive;
  if ("defaultAssigneeMonteurId" in body) data.defaultAssigneeMonteur = body.defaultAssigneeMonteurId ? { connect: { id: body.defaultAssigneeMonteurId } } : { disconnect: true };
  if ("defaultAssigneeCmId" in body) data.defaultAssigneeCm = body.defaultAssigneeCmId ? { connect: { id: body.defaultAssigneeCmId } } : { disconnect: true };
  if ("defaultAssigneeVideasteId" in body) data.defaultAssigneeVideaste = body.defaultAssigneeVideasteId ? { connect: { id: body.defaultAssigneeVideasteId } } : { disconnect: true };
  if ("captionPresetId" in body) data.captionPreset = body.captionPresetId ? { connect: { id: body.captionPresetId } } : { disconnect: true };
  if ("descriptionPromptId" in body) data.descriptionPrompt = body.descriptionPromptId ? { connect: { id: body.descriptionPromptId } } : { disconnect: true };
  if ("notes" in body) data.notes = body.notes ?? null;

  try {
    const pattern = await prisma.accountPattern.update({
      where: { id: patternId },
      data,
      include: patternIncludes,
    });
    return NextResponse.json(pattern);
  } catch (err: unknown) {
    console.error("[admin/accounts/[id]/patterns/[patternId]] PATCH error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const userContext = await getUserContext();
  if (!userContext?.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id, patternId } = await params;

  // Vérification d'appartenance anti-énumération + count slots
  const pattern = await prisma.accountPattern.findFirst({
    where: { id: patternId, accountId: id },
    include: { _count: { select: { publicationSlots: true } } },
  });

  if (!pattern) {
    return NextResponse.json({ error: "Pattern introuvable" }, { status: 404 });
  }

  const slotCount = pattern._count.publicationSlots;
  if (slotCount > 0) {
    return NextResponse.json(
      { error: `Ce pattern a ${slotCount} slot${slotCount > 1 ? "s" : ""} associé${slotCount > 1 ? "s" : ""}. Supprimez-les d'abord.` },
      { status: 400 }
    );
  }

  await prisma.accountPattern.delete({ where: { id: patternId } });
  return new NextResponse(null, { status: 204 });
}
