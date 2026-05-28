/**
 * GET    /api/publications/[id]/versions/[versionId] → presigned download URL (1h)
 * PUT    /api/publications/[id]/versions/[versionId] → mise à jour des notes (max 2000 chars)
 * DELETE /api/publications/[id]/versions/[versionId] → soft-delete
 *
 * Auth : getUserContext(). Scope : canUserAccessSlot (404 anti-énumération).
 *
 * Décision notable (notes) : la mise à jour des notes n'est PAS loggée dans
 * l'activité pour éviter le bruit — seule la modification des métadonnées
 * structurelles (upload, promotion, suppression) génère un log.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { canDeleteVersion } from "@/lib/permissions/publications";
import { toUserRole } from "@/lib/permissions/role";
import { createPresignedDownloadUrl } from "@/lib/r2";
import { logActivity } from "@/lib/services/slot/activity";

type Params = { params: Promise<{ id: string; versionId: string }> };

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function getContext(params: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) return null;

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id: slotId, versionId } = await params.params;

  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: {
      id: true,
      status: true,
      currentVersionId: true,
      assigneeMonteurId: true,
      assigneeCmId: true, assigneeVideasteId: true,
    },
  });

  if (!slot || !canUserAccessSlot(slot, role, userId)) return null;

  return { userId, role, slot, slotId, versionId };
}

// ─── GET — presigned download URL ─────────────────────────────────────────────

export async function GET(_req: NextRequest, ctxParams: Params) {
  const ctx = await getContext(ctxParams);
  if (!ctx) {
    return NextResponse.json({ error: "Publication introuvable" }, { status: 404 });
  }

  const { slotId, versionId } = ctx;

  const version = await prisma.publicationVersion.findFirst({
    where: { id: versionId, slotId, deletedAt: null },
  });

  if (!version) {
    return NextResponse.json({ error: "Version introuvable" }, { status: 404 });
  }

  try {
    const downloadUrl = await createPresignedDownloadUrl(version.r2Key, version.fileName, 3600);
    return NextResponse.json({ downloadUrl });
  } catch {
    return NextResponse.json(
      { error: "Erreur de génération de l'URL de téléchargement" },
      { status: 500 }
    );
  }
}

// ─── PUT — mise à jour des notes ──────────────────────────────────────────────

export async function PUT(req: NextRequest, ctxParams: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id: slotId, versionId } = await ctxParams.params;

  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: { id: true, status: true, assigneeMonteurId: true, assigneeCmId: true, assigneeVideasteId: true },
  });

  if (!slot || !canUserAccessSlot(slot, role, userId)) {
    return NextResponse.json({ error: "Publication introuvable" }, { status: 404 });
  }

  const version = await prisma.publicationVersion.findFirst({
    where: { id: versionId, slotId, deletedAt: null },
    select: { id: true, uploadedByUserId: true },
  });

  if (!version) {
    return NextResponse.json({ error: "Version introuvable" }, { status: 404 });
  }

  // Seul l'auteur ou un ADMIN peut modifier les notes
  const isAdmin = role === "ADMIN";
  const isAuthor = version.uploadedByUserId === userId;
  if (!isAdmin && !isAuthor) {
    return NextResponse.json({ error: "Permission refusée" }, { status: 403 });
  }

  const body = await req.json() as { notes?: unknown };
  const notes = typeof body.notes === "string" ? body.notes : "";

  if (notes.length > 2000) {
    return NextResponse.json(
      { error: "Les notes ne peuvent pas dépasser 2000 caractères" },
      { status: 400 }
    );
  }

  await prisma.publicationVersion.update({
    where: { id: versionId },
    data: { notes },
  });

  // Décision : ne PAS logger la mise à jour des notes (trop de bruit).
  // Seules les actions structurelles (upload, promote, delete) sont loggées.

  return NextResponse.json({ ok: true });
}

// ─── DELETE — soft-delete ─────────────────────────────────────────────────────

export async function DELETE(_req: NextRequest, ctxParams: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id: slotId, versionId } = await ctxParams.params;

  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: {
      id: true,
      status: true,
      currentVersionId: true,
      assigneeMonteurId: true,
      assigneeCmId: true, assigneeVideasteId: true,
    },
  });

  if (!slot || !canUserAccessSlot(slot, role, userId)) {
    return NextResponse.json({ error: "Publication introuvable" }, { status: 404 });
  }

  const version = await prisma.publicationVersion.findFirst({
    where: { id: versionId, slotId, deletedAt: null },
  });

  if (!version) {
    return NextResponse.json({ error: "Version introuvable" }, { status: 404 });
  }

  // Refuser si c'est la version courante
  if (slot.currentVersionId === versionId) {
    return NextResponse.json(
      {
        error:
          "Impossible de supprimer la version courante. Promouvez d'abord une autre version.",
      },
      { status: 400 }
    );
  }

  if (!canDeleteVersion({ id: userId, role }, version)) {
    return NextResponse.json({ error: "Permission refusée" }, { status: 403 });
  }

  await prisma.publicationVersion.update({
    where: { id: versionId },
    data: { deletedAt: new Date() },
  });

  await logActivity(prisma, {
    slotId,
    actorId: userContext.actualUser.id,
    type: "VERSION_DELETED",
    payload: { versionId, versionNumber: version.versionNumber, fileName: version.fileName },
  });

  return NextResponse.json({ ok: true });
}
