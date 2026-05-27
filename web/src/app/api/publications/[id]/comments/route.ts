/**
 * GET  /api/publications/[id]/comments — liste les commentaires d'un slot
 * POST /api/publications/[id]/comments — ajoute un commentaire
 *
 * GET :
 *   - Ordre chronologique (oldest first).
 *   - Inclut deletedAt : l'UI affiche "Message supprimé" à la place du body côté client.
 *   - Check canCommentOnPublication → 403 si refusé.
 *
 * POST :
 *   - Body : { body: string }. Validation : non-vide après trim, max 5000 chars.
 *   - Auteur = effectiveUser.
 *   - Après insert : logActivity COMMENT_ADDED.
 *   - Retourne le commentaire créé (avec relation author).
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { canCommentOnPublication } from "@/lib/permissions/publications";
import { logActivity } from "@/lib/publications/activity";
import { toUserRole } from "@/lib/permissions/role";

const MAX_COMMENT_LENGTH = 5000;

type Params = { params: Promise<{ id: string }> };

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export async function GET(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id: slotId } = await params;

  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: { id: true, assigneeMonteurId: true, assigneeCmId: true },
  });

  if (!slot || !canUserAccessSlot(slot, role, userId)) {
    return NextResponse.json({ error: "Slot introuvable" }, { status: 404 });
  }

  if (!canCommentOnPublication({ id: userId, role }, slot)) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const comments = await prisma.publicationComment.findMany({
    where: { slotId },
    orderBy: { createdAt: "asc" },
    include: {
      author: { select: { id: true, name: true, email: true } },
    },
  });

  return NextResponse.json({ comments });
}

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id: slotId } = await params;

  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: { id: true, assigneeMonteurId: true, assigneeCmId: true },
  });

  if (!slot || !canUserAccessSlot(slot, role, userId)) {
    return NextResponse.json({ error: "Slot introuvable" }, { status: 404 });
  }

  if (!canCommentOnPublication({ id: userId, role }, slot)) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
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

  const trimmedBody = body.trim();

  // E2 — race condition fix : entre le check `canCommentOnPublication` et le
  // create ci-dessous, le slot peut être supprimé par un autre process. Sans
  // protection, on aurait un 500 (Prisma P2003 = FK violation). On catch et
  // retourne 404 pour aligner avec le comportement "slot introuvable" du
  // happy path.
  let comment;
  try {
    comment = await prisma.publicationComment.create({
      data: {
        slotId,
        authorId: userId,
        body: trimmedBody,
      },
      include: {
        author: { select: { id: true, name: true, email: true } },
      },
    });
  } catch (err) {
    // Prisma P2003 : FK violation (slotId ou authorId n'existe plus en base).
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2003"
    ) {
      return NextResponse.json({ error: "Slot introuvable" }, { status: 404 });
    }
    throw err;
  }

  // Log non bloquant : une erreur ici ne doit pas casser la réponse.
  await logActivity(prisma, {
    slotId,
    actorId: userId,
    type: "COMMENT_ADDED",
    payload: {
      commentId: comment.id,
      excerpt: trimmedBody.slice(0, 100),
    },
  });

  return NextResponse.json({ comment }, { status: 201 });
}
