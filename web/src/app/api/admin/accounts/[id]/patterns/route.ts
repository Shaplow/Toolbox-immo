/**
 * GET  /api/admin/accounts/[id]/patterns — liste les patterns du compte
 * POST /api/admin/accounts/[id]/patterns — crée un pattern sur le compte
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import {
  validatePatternConfig,
  type PatternValidationInput,
  type PatternValidationError,
  type TemplateValidationContext,
} from "@/lib/publications/patternValidation";

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

type PostBody = {
  label?: string;
  source?: string;
  templateId?: string | null;
  coverMode?: string;
  coverConfig?: unknown;
  needsDescription?: string;
  needsCaptions?: boolean;
  needsAdminValidation?: boolean;
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

function validatePatternBody(body: PostBody, requireAll: boolean): string | null {
  if (requireAll) {
    if (!body.label?.trim()) return "Le champ label est requis";
    if (!body.source) return "Le champ source est requis";
    if (!body.coverMode) return "Le champ coverMode est requis";
    if (!body.needsDescription) return "Le champ needsDescription est requis";
    // dayOfWeek peut être vide → pattern "manuel" (sans génération auto).
    if (!Array.isArray(body.dayOfWeek)) return "Le champ dayOfWeek doit être un tableau";
    if (!body.publishTime) return "Le champ publishTime est requis";
  }

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

/**
 * Charge le contexte template (liste des coverPresets) puis applique
 * la validation cross-field via le helper centralisé. Retourne `[]` si OK.
 *
 * Le caller doit s'assurer que tous les champs du body sont déjà remplis
 * (utiliser après validatePatternBody(body, requireAll=true) pour POST,
 * ou après merge avec l'existant pour PATCH).
 */
export async function validatePatternCrossFields(
  fullInput: PatternValidationInput,
): Promise<PatternValidationError[]> {
  let templateContext: TemplateValidationContext | null = null;
  if (fullInput.templateId) {
    const presets = await prisma.templateCoverPreset.findMany({
      where: { templateId: fullInput.templateId },
      select: { id: true, name: true },
    });
    templateContext = {
      coverPresetNames: presets.map((p) => p.name),
      coverPresetIds: presets.map((p) => p.id),
    };
  }
  return validatePatternConfig(fullInput, templateContext);
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userContext = await getUserContext();
  if (!userContext?.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;

  const account = await prisma.instagramAccount.findUnique({ where: { id }, select: { id: true } });
  if (!account) {
    return NextResponse.json({ error: "Compte introuvable" }, { status: 404 });
  }

  const patterns = await prisma.accountPattern.findMany({
    where: { accountId: id },
    orderBy: [{ publishTime: "asc" }, { label: "asc" }],
    include: patternIncludes,
  });

  return NextResponse.json(patterns);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userContext = await getUserContext();
  if (!userContext?.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;

  const account = await prisma.instagramAccount.findUnique({ where: { id }, select: { id: true } });
  if (!account) {
    return NextResponse.json({ error: "Compte introuvable" }, { status: 404 });
  }

  const body = await req.json() as PostBody;
  const validationError = validatePatternBody(body, true);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  // Validation cross-field (cohérence métier — règles C1-C5 + C10)
  const xfieldErrors = await validatePatternCrossFields({
    source: body.source!,
    templateId: body.templateId ?? null,
    coverMode: body.coverMode!,
    coverConfig: body.coverConfig ?? null,
    needsCaptions: body.needsCaptions ?? false,
    needsDescription: body.needsDescription!,
    needsClientValidation: body.needsClientValidation ?? false,
    allowsClientRevision: body.allowsClientRevision ?? false,
    captionPresetId: body.captionPresetId ?? null,
    descriptionPromptId: body.descriptionPromptId ?? null,
  });
  if (xfieldErrors.length > 0) {
    return NextResponse.json(
      { error: "Pattern incohérent — corrigez les conflits avant de sauvegarder.", validationErrors: xfieldErrors },
      { status: 422 },
    );
  }

  try {
    const pattern = await prisma.accountPattern.create({
      data: {
        accountId: id,
        label: body.label!.trim(),
        source: body.source!,
        templateId: body.templateId ?? null,
        coverMode: body.coverMode!,
        coverConfig: body.coverConfig !== undefined ? (body.coverConfig as import("@prisma/client").Prisma.InputJsonValue) : undefined,
        needsDescription: body.needsDescription!,
        needsCaptions: body.needsCaptions ?? false,
        needsAdminValidation: body.needsAdminValidation ?? false,
        needsClientValidation: body.needsClientValidation ?? false,
        allowsClientRevision: body.allowsClientRevision ?? false,
        needsRushes: body.needsRushes ?? false,
        needsBrief: body.needsBrief ?? false,
        dayOfWeek: [...new Set(body.dayOfWeek!)].sort((a, b) => a - b),
        publishTime: body.publishTime!,
        isActive: body.isActive ?? true,
        defaultAssigneeMonteurId: body.defaultAssigneeMonteurId ?? null,
        defaultAssigneeCmId: body.defaultAssigneeCmId ?? null,
        defaultAssigneeVideasteId: body.defaultAssigneeVideasteId ?? null,
        captionPresetId: body.captionPresetId ?? null,
        descriptionPromptId: body.descriptionPromptId ?? null,
        notes: body.notes ?? null,
      },
      include: patternIncludes,
    });
    return NextResponse.json(pattern, { status: 201 });
  } catch (err: unknown) {
    console.error("[admin/accounts/[id]/patterns] POST error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
