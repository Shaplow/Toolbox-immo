/**
 * GET /api/admin/patterns/[id] — détail d'un PatternTemplate + bindings liés.
 * PATCH /api/admin/patterns/[id] — édite la recette globale (propage aux
 *   bindings sans override lors des prochaines créations slots).
 * DELETE /api/admin/patterns/[id] — archive (soft) le template ; les bindings
 *   existants restent valides.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import {
  normalizeSourceFieldKey,
  normalizeFixedText,
} from "@/lib/publications/preFilledDescription";
type PatchBody = {
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
  isArchived?: boolean;
  autoSaveToLibraryId?: string | null;
};

const VALID_SOURCES = ["auto_template", "manual_rushes", "external_upload"];
const VALID_CAPTIONS_MODES = ["none", "auto", "manual"];
const VALID_DESCRIPTION_MODES = ["none", "preFilled", "fixed", "autoGenerate", "manualWrite"];
const VALID_COVER_MODES = ["none", "manualSelect", "autoPack", "monteurUpload"];

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const ctx = await getUserContext();
  if (!ctx?.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }
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
  const ctx = await getUserContext();
  if (!ctx?.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }
  const { id } = await params;
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  if (body.source !== undefined && !VALID_SOURCES.includes(body.source)) {
    return NextResponse.json({ error: "source invalide" }, { status: 400 });
  }
  if (body.needsCaptionsMode !== undefined && !VALID_CAPTIONS_MODES.includes(body.needsCaptionsMode)) {
    return NextResponse.json({ error: "needsCaptionsMode invalide" }, { status: 400 });
  }
  if (body.needsDescription !== undefined && !VALID_DESCRIPTION_MODES.includes(body.needsDescription)) {
    return NextResponse.json({ error: "needsDescription invalide" }, { status: 400 });
  }
  if (body.coverMode !== undefined && !VALID_COVER_MODES.includes(body.coverMode)) {
    return NextResponse.json({ error: "coverMode invalide" }, { status: 400 });
  }
  // Valide requiresEntityTypeId si fourni (non null).
  if (body.requiresEntityTypeId) {
    const type = await prisma.entityType.findUnique({
      where: { id: body.requiresEntityTypeId },
      select: { id: true },
    });
    if (!type) {
      return NextResponse.json({ error: "requiresEntityTypeId : type de fiche introuvable" }, { status: 400 });
    }
  }

  // Valide autoSaveToLibraryId si fourni (non null).
  if (body.autoSaveToLibraryId) {
    const lib = await prisma.mediaLibrary.findUnique({
      where: { id: body.autoSaveToLibraryId },
      select: { id: true, type: true },
    });
    if (!lib) {
      return NextResponse.json({ error: "autoSaveToLibraryId : bibliothèque introuvable" }, { status: 400 });
    }
    if (lib.type !== "video") {
      return NextResponse.json(
        { error: "autoSaveToLibraryId : la bibliothèque doit être de type vidéo" },
        { status: 400 },
      );
    }
  }

  const updated = await prisma.patternTemplate.update({
    where: { id },
    data: {
      ...(body.label !== undefined ? { label: body.label.trim() } : {}),
      ...(body.source !== undefined ? { source: body.source } : {}),
      ...(body.templateId !== undefined ? { templateId: body.templateId } : {}),
      ...(body.captionPresetId !== undefined ? { captionPresetId: body.captionPresetId } : {}),
      ...(body.descriptionPromptId !== undefined ? { descriptionPromptId: body.descriptionPromptId } : {}),
      ...(body.descriptionSourceFieldKey !== undefined
        ? { descriptionSourceFieldKey: normalizeSourceFieldKey(body.descriptionSourceFieldKey) }
        : {}),
      ...(body.descriptionFixedText !== undefined
        ? { descriptionFixedText: normalizeFixedText(body.descriptionFixedText) }
        : {}),
      ...(body.coverMode !== undefined ? { coverMode: body.coverMode } : {}),
      ...(body.coverConfig !== undefined
        ? { coverConfig: body.coverConfig === null ? undefined : (body.coverConfig as object) }
        : {}),
      ...(body.needsDescription !== undefined ? { needsDescription: body.needsDescription } : {}),
      ...(body.needsCaptionsMode !== undefined
        ? {
            needsCaptionsMode: body.needsCaptionsMode,
            needsCaptions: body.needsCaptionsMode === "auto",
          }
        : {}),
      ...(body.needsAdminValidation !== undefined ? { needsAdminValidation: body.needsAdminValidation } : {}),
      ...(body.needsClientValidation !== undefined ? { needsClientValidation: body.needsClientValidation } : {}),
      ...(body.allowsClientRevision !== undefined ? { allowsClientRevision: body.allowsClientRevision } : {}),
      ...(body.needsBrief !== undefined ? { needsBrief: body.needsBrief } : {}),
      ...(body.requiresProperty !== undefined ? { requiresProperty: body.requiresProperty } : {}),
      ...(body.requiresEntityTypeId !== undefined
        ? { requiresEntityTypeId: body.requiresEntityTypeId }
        : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.isArchived !== undefined ? { isArchived: body.isArchived } : {}),
      ...(body.autoSaveToLibraryId !== undefined
        ? { autoSaveToLibraryId: body.autoSaveToLibraryId }
        : {}),
      // Sprint D — audit log light : trace l'auteur de l'édition.
      updatedByUserId: ctx.actualUser.id,
    },
  });
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const ctx = await getUserContext();
  if (!ctx?.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }
  const { id } = await params;

  // Soft-delete via isArchived. Les bindings + slots historiques restent
  // fonctionnels mais le template disparaît du catalogue.
  const archived = await prisma.patternTemplate.update({
    where: { id },
    data: { isArchived: true },
  });
  return NextResponse.json({ archived: true, id: archived.id });
}
