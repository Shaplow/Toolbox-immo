/**
 * PATCH /api/admin/cursors/media/[libraryId]/[accountId]
 *
 * Met à jour manuellement le curseur d'un compte pour une MediaLibrary.
 * Body : { cursor?: number, lastUsedSetTag?: string | null, lastUsedCategory?: string | null }
 *
 * - cursor est clampé dans [0, setSequence.length) si setSequence non vide.
 * - Upsert : crée la row si elle n'existait pas encore.
 * - accountId peut être SHARED_CURSOR_ACCOUNT_ID pour les libs shared.
 *
 * Auth : ADMIN uniquement.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { SHARED_CURSOR_ACCOUNT_ID } from "@/lib/contentLibraryResolver";

type Params = { params: Promise<{ libraryId: string; accountId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { libraryId, accountId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const { cursor, lastUsedSetTag, lastUsedCategory } = body as {
    cursor?: number;
    lastUsedSetTag?: string | null;
    lastUsedCategory?: string | null;
  };

  // Validate that at least one field is provided
  if (cursor === undefined && lastUsedSetTag === undefined && lastUsedCategory === undefined) {
    return NextResponse.json({ error: "Aucun champ à mettre à jour" }, { status: 400 });
  }

  try {
    const library = await prisma.mediaLibrary.findUnique({
      where: { id: libraryId },
      select: { id: true, rotationScope: true, setSequence: true },
    });
    if (!library) {
      return NextResponse.json({ error: "Bibliothèque introuvable" }, { status: 404 });
    }

    // Validate accountId: must be an existing account or SHARED_CURSOR_ACCOUNT_ID
    if (accountId !== SHARED_CURSOR_ACCOUNT_ID) {
      const account = await prisma.instagramAccount.findUnique({
        where: { id: accountId },
        select: { id: true },
      });
      if (!account) {
        return NextResponse.json({ error: "Compte introuvable" }, { status: 404 });
      }
    }

    // Clamp cursor if setSequence is non-empty
    let clampedCursor = cursor;
    if (clampedCursor !== undefined) {
      let sequence: string[] = [];
      try {
        sequence = (JSON.parse(library.setSequence) as string[]).filter(Boolean);
      } catch {
        sequence = [];
      }

      if (sequence.length > 0) {
        clampedCursor = Math.max(0, Math.min(clampedCursor, sequence.length - 1));
      } else {
        clampedCursor = Math.max(0, clampedCursor);
      }
    }

    const data: {
      cursor?: number;
      lastUsedSetTag?: string | null;
      lastUsedCategory?: string | null;
      lastAdvancedAt: Date;
    } = { lastAdvancedAt: new Date() };

    if (clampedCursor !== undefined) data.cursor = clampedCursor;
    if (lastUsedSetTag !== undefined) data.lastUsedSetTag = lastUsedSetTag;
    if (lastUsedCategory !== undefined) data.lastUsedCategory = lastUsedCategory;

    const updated = await prisma.accountLibraryCursor.upsert({
      where: {
        accountId_libraryId: { accountId, libraryId },
      },
      update: data,
      create: {
        accountId,
        libraryId,
        cursor: clampedCursor ?? 0,
        lastUsedSetTag: lastUsedSetTag ?? null,
        lastUsedCategory: lastUsedCategory ?? null,
        lastAdvancedAt: new Date(),
      },
    });

    return NextResponse.json({
      ok: true,
      cursor: {
        accountId,
        libraryId,
        cursor: updated.cursor,
        lastUsedSetTag: updated.lastUsedSetTag,
        lastUsedCategory: updated.lastUsedCategory,
        lastAdvancedAt: updated.lastAdvancedAt?.toISOString() ?? null,
      },
    });
  } catch (err) {
    console.error("[admin/cursors/media] PATCH error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
