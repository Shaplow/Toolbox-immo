/**
 * PATCH /api/admin/cursors/data/[libraryId]/[accountId]
 *
 * Met à jour manuellement le curseur d'un compte pour une DataLibrary.
 * Body : { lastUsedSetTag?: string | null, lastUsedCategory?: string | null }
 *
 * Note : DataLibrary n'a pas de curseur Int (pas encore de setSequence/override).
 * Seuls lastUsedSetTag et lastUsedCategory sont disponibles.
 *
 * accountId peut être SHARED_DATA_CURSOR_ACCOUNT_ID pour les libs shared.
 *
 * Auth : ADMIN uniquement.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { SHARED_DATA_CURSOR_ACCOUNT_ID } from "@/lib/contentLibraryResolver";

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

  const { lastUsedSetTag, lastUsedCategory } = body as {
    lastUsedSetTag?: string | null;
    lastUsedCategory?: string | null;
  };

  if (lastUsedSetTag === undefined && lastUsedCategory === undefined) {
    return NextResponse.json({ error: "Aucun champ à mettre à jour" }, { status: 400 });
  }

  try {
    const library = await prisma.dataLibrary.findUnique({
      where: { id: libraryId },
      select: { id: true, rotationScope: true },
    });
    if (!library) {
      return NextResponse.json({ error: "Bibliothèque introuvable" }, { status: 404 });
    }

    // Validate accountId: must be an existing account or SHARED_DATA_CURSOR_ACCOUNT_ID
    if (accountId !== SHARED_DATA_CURSOR_ACCOUNT_ID) {
      const account = await prisma.instagramAccount.findUnique({
        where: { id: accountId },
        select: { id: true },
      });
      if (!account) {
        return NextResponse.json({ error: "Compte introuvable" }, { status: 404 });
      }
    }

    const data: {
      lastUsedSetTag?: string | null;
      lastUsedCategory?: string | null;
      lastAdvancedAt: Date;
    } = { lastAdvancedAt: new Date() };

    if (lastUsedSetTag !== undefined) data.lastUsedSetTag = lastUsedSetTag;
    if (lastUsedCategory !== undefined) data.lastUsedCategory = lastUsedCategory;

    const updated = await prisma.accountDataLibraryCursor.upsert({
      where: {
        accountId_libraryId: { accountId, libraryId },
      },
      update: data,
      create: {
        accountId,
        libraryId,
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
        lastUsedSetTag: updated.lastUsedSetTag,
        lastUsedCategory: updated.lastUsedCategory,
        lastAdvancedAt: updated.lastAdvancedAt?.toISOString() ?? null,
      },
    });
  } catch (err) {
    console.error("[admin/cursors/data] PATCH error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
