/**
 * PATCH  /api/publications/[id]/comments/[commentId] — édite un commentaire
 * DELETE /api/publications/[id]/comments/[commentId] — soft-delete un commentaire
 *
 * PATCH :
 *   - Body : { body: string }. Validation : non-vide après trim, max 5000 chars.
 *   - Check canEditComment (auteur ou ADMIN).
 *   - Refuse si le commentaire est déjà soft-deleted.
 *   - Met à jour body + updatedAt.
 *
 * DELETE :
 *   - Soft-delete : set deletedAt = now().
 *   - Check canEditComment (auteur ou ADMIN).
 *   - Refuse si déjà soft-deleted (409 Conflict).
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { canEditComment } from "@/lib/permissions/publications";
import { toUserRole } from "@/lib/permissions/role";
import type { UserRole } from "@/types/roles";

const MAX_COMMENT_LENGTH = 5000;

type Params = { params: Promise<{ id: string; commentId: string }> };

// ---------------------------------------------------------------------------
// Shared: résoudre le slot + le commentaire et vérifier les accès
// ---------------------------------------------------------------------------

async function resolveCommentOrError(
  slotId: string,
  commentId: string,
  role: UserRole,
  userId: string
) {
  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: { id: true, assigneeMonteurId: true, assigneeCmId: true, assigneeVideasteId: true },
  });

  if (!slot || !canUserAccessSlot(slot, role, userId)) {
    return { error: NextResponse.json({ error: "Slot introuvable" }, { status: 404 }) };
  }

  const comment = await prisma.publicationComment.findUnique({
    where: { id: commentId },
    select: { id: true, slotId: true, authorId: true, deletedAt: true },
  });

  if (!comment || comment.slotId !== slotId) {
    return { error: NextResponse.json({ error: "Commentaire introuvable" }, { status: 404 }) };
  }

  if (!canEditComment({ id: userId, role }, comment)) {
    return { error: NextResponse.json({ error: "Accès refusé" }, { status: 403 }) };
  }

  return { slot, comment };
}

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------

export async function PATCH(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id: slotId, commentId } = await params;

  const resolved = await resolveCommentOrError(slotId, commentId, role, userId);
  if ("error" in resolved) return resolved.error;
  const { comment } = resolved;

  if (comment.deletedAt !== null) {
    return NextResponse.json(
      { error: "Impossible de modifier un commentaire supprimé" },
      { status: 409 }
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const body = (rawBody as Record<string, unknown>)?.body;
  if (typeof body !== "string" || body.trim().length === 0) {
    return NextResponse.json({ error: "Le commentaire ne peut pas être vide" }, { status: 400 });
  }
  if (body.trim().length > MAX_COMMENT_LENGTH) {
    return NextResponse.json(
      { error: `Le commentaire dépasse ${MAX_COMMENT_LENGTH} caractères` },
      { status: 400 }
    );
  }

  const updated = await prisma.publicationComment.update({
    where: { id: commentId },
    data: { body: body.trim() },
    include: {
      author: { select: { id: true, name: true, email: true } },
    },
  });

  return NextResponse.json({ comment: updated });
}

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

export async function DELETE(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id: slotId, commentId } = await params;

  const resolved = await resolveCommentOrError(slotId, commentId, role, userId);
  if ("error" in resolved) return resolved.error;
  const { comment } = resolved;

  if (comment.deletedAt !== null) {
    return NextResponse.json(
      { error: "Ce commentaire est déjà supprimé" },
      { status: 409 }
    );
  }

  await prisma.publicationComment.update({
    where: { id: commentId },
    data: { deletedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
