/**
 * GET /api/admin/patterns — catalogue des PatternTemplate (recettes globales).
 * POST /api/admin/patterns — crée une nouvelle recette globale.
 *
 * Admin-only. Une recette globale peut être appliquée à N comptes via
 * PatternBinding (route `/api/admin/accounts/[id]/bindings`).
 */
import { VALID_SOURCES, VALID_CAPTIONS_MODES, VALID_DESCRIPTION_MODES, VALID_COVER_MODES } from "@/lib/publications/patternEnums";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import {
  normalizeSourceFieldKey,
  normalizeFixedText,
} from "@/lib/publications/preFilledDescription";
type CreateBody = {
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
  autoSaveToLibraryId?: string | null;
};


function validateBody(body: CreateBody, requireAll: boolean): string | null {
  if (requireAll) {
    if (!body.label?.trim()) return "label requis";
    if (!body.source) return "source requise";
  }
  if (body.source !== undefined && !VALID_SOURCES.includes(body.source)) {
    return `source invalide (attendu : ${VALID_SOURCES.join(", ")})`;
  }
  if (body.needsCaptionsMode !== undefined && !VALID_CAPTIONS_MODES.includes(body.needsCaptionsMode)) {
    return `needsCaptionsMode invalide`;
  }
  if (body.needsDescription !== undefined && !VALID_DESCRIPTION_MODES.includes(body.needsDescription)) {
    return `needsDescription invalide`;
  }
  if (body.coverMode !== undefined && !VALID_COVER_MODES.includes(body.coverMode)) {
    return `coverMode invalide`;
  }
  return null;
}

export async function GET() {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const ctx = auth.ctx;
  const templates = await prisma.patternTemplate.findMany({
    where: { isArchived: false },
    orderBy: [{ source: "asc" }, { label: "asc" }],
    include: {
      _count: { select: { bindings: true } },
    },
  });
  return NextResponse.json(templates);
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const ctx = auth.ctx;
  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }
  const err = validateBody(body, true);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  // Valide requiresEntityTypeId si fourni.
  if (body.requiresEntityTypeId) {
    const type = await prisma.entityType.findUnique({
      where: { id: body.requiresEntityTypeId },
      select: { id: true },
    });
    if (!type) {
      return NextResponse.json({ error: "requiresEntityTypeId : type de fiche introuvable" }, { status: 400 });
    }
  }

  // Valide autoSaveToLibraryId si fourni.
  if (body.autoSaveToLibraryId) {
    const lib = await prisma.mediaLibrary.findUnique({
      where: { id: body.autoSaveToLibraryId },
      select: { id: true, type: true },
    });
    if (!lib) {
      return NextResponse.json({ error: "autoSaveToLibraryId : bibliothèque introuvable" }, { status: 400 });
    }
    if (lib.type !== "video") {
      return NextResponse.json({ error: "autoSaveToLibraryId : la bibliothèque doit être de type vidéo" }, { status: 400 });
    }
  }

  const created = await prisma.patternTemplate.create({
    data: {
      label: body.label!.trim(),
      source: body.source!,
      templateId: body.templateId ?? null,
      captionPresetId: body.captionPresetId ?? null,
      descriptionPromptId: body.descriptionPromptId ?? null,
      descriptionSourceFieldKey: normalizeSourceFieldKey(body.descriptionSourceFieldKey),
      descriptionFixedText: normalizeFixedText(body.descriptionFixedText),
      coverMode: body.coverMode ?? "none",
      coverConfig:
        body.coverConfig === undefined || body.coverConfig === null
          ? undefined
          : (body.coverConfig as object),
      needsDescription: body.needsDescription ?? "none",
      needsCaptionsMode: body.needsCaptionsMode ?? "none",
      needsAdminValidation: body.needsAdminValidation ?? false,
      needsClientValidation: body.needsClientValidation ?? false,
      allowsClientRevision: body.allowsClientRevision ?? false,
      needsBrief: body.needsBrief ?? false,
      requiresProperty: body.requiresProperty ?? false,
      requiresEntityTypeId: body.requiresEntityTypeId ?? null,
      notes: body.notes ?? null,
      autoSaveToLibraryId: body.autoSaveToLibraryId ?? null,
      // Sprint D — audit log light : trace l'auteur de la création.
      updatedByUserId: ctx.actualUser.id,
    },
  });
  return NextResponse.json(created, { status: 201 });
}

export type PatternTemplateCreateBody = CreateBody;
