/**
 * GET /api/admin/cursors?type=media|data&libraryId=…
 *
 * Retourne la liste des curseurs par compte pour une bibliothèque donnée.
 *
 * Pour les libs "shared" : 1 seule row avec accountId = SHARED_*_ACCOUNT_ID.
 * Pour les libs "per_account" : 1 row par compte qui a au moins accès à la lib
 *   (MediaAssetAccess ou DataEntryAccess) OU qui possède déjà un curseur enregistré.
 *
 * Réponse :
 * {
 *   scope: "shared" | "per_account",
 *   rows: Array<{
 *     accountId: string,
 *     handle: string | null,
 *     isShared: boolean,
 *     cursor?: number,       // Media uniquement (Int dans AccountLibraryCursor)
 *     lastUsedSetTag: string | null,
 *     lastUsedCategory: string | null,
 *     lastAdvancedAt: string | null,
 *   }>
 * }
 *
 * Auth : ADMIN uniquement.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import {
  SHARED_CURSOR_ACCOUNT_ID,
  SHARED_DATA_CURSOR_ACCOUNT_ID,
} from "@/lib/contentLibraryResolver";

export async function GET(req: NextRequest) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const libraryId = searchParams.get("libraryId");

  if (!libraryId) {
    return NextResponse.json({ error: "libraryId requis" }, { status: 400 });
  }
  if (type !== "media" && type !== "data") {
    return NextResponse.json({ error: "type doit être media ou data" }, { status: 400 });
  }

  try {
    if (type === "media") {
      return await getMediaCursors(libraryId);
    } else {
      return await getDataCursors(libraryId);
    }
  } catch (err) {
    console.error("[admin/cursors] GET error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

async function getMediaCursors(libraryId: string): Promise<NextResponse> {
  const library = await prisma.mediaLibrary.findUnique({
    where: { id: libraryId },
    select: { id: true, name: true, rotationScope: true, setSequence: true },
  });
  if (!library) {
    return NextResponse.json({ error: "Bibliothèque introuvable" }, { status: 404 });
  }

  const scope = (library.rotationScope ?? "per_account") as "shared" | "per_account";

  if (scope === "shared") {
    // 1 seule row : le curseur partagé keyed by SHARED_CURSOR_ACCOUNT_ID
    const cursor = await prisma.accountLibraryCursor.findUnique({
      where: {
        accountId_libraryId: { accountId: SHARED_CURSOR_ACCOUNT_ID, libraryId },
      },
      select: {
        cursor: true,
        lastUsedSetTag: true,
        lastUsedCategory: true,
        lastAdvancedAt: true,
      },
    });

    return NextResponse.json({
      scope,
      rows: [
        {
          accountId: SHARED_CURSOR_ACCOUNT_ID,
          handle: null,
          isShared: true,
          cursor: cursor?.cursor ?? 0,
          lastUsedSetTag: cursor?.lastUsedSetTag ?? null,
          lastUsedCategory: cursor?.lastUsedCategory ?? null,
          lastAdvancedAt: cursor?.lastAdvancedAt?.toISOString() ?? null,
        },
      ],
    });
  }

  // per_account : tous les comptes ayant un accès asset dans cette lib
  // OU ayant déjà un curseur.
  const [accountsWithAccess, existingCursors] = await Promise.all([
    prisma.instagramAccount.findMany({
      where: {
        assetAccesses: { some: { asset: { libraryId } } },
      },
      select: { id: true, handle: true },
      orderBy: { handle: "asc" },
    }),
    prisma.accountLibraryCursor.findMany({
      where: { libraryId },
      select: {
        accountId: true,
        cursor: true,
        lastUsedSetTag: true,
        lastUsedCategory: true,
        lastAdvancedAt: true,
      },
    }),
  ]);

  // Merge : union des comptes avec accès + comptes ayant déjà un curseur
  const cursorMap = new Map(existingCursors.map((c) => [c.accountId, c]));
  const accountSet = new Map(accountsWithAccess.map((a) => [a.id, a.handle]));

  // Add accounts from existing cursors that might not have explicit access rows
  for (const c of existingCursors) {
    if (!accountSet.has(c.accountId) && c.accountId !== SHARED_CURSOR_ACCOUNT_ID) {
      // Fetch account info
      const acc = await prisma.instagramAccount.findUnique({
        where: { id: c.accountId },
        select: { id: true, handle: true },
      });
      if (acc) accountSet.set(acc.id, acc.handle);
    }
  }

  // Trier par handle
  const sortedAccountIds = [...accountSet.entries()]
    .sort(([, a], [, b]) => a.localeCompare(b))
    .map(([id]) => id);

  const rows = sortedAccountIds.map((accountId) => {
    const handle = accountSet.get(accountId) ?? null;
    const c = cursorMap.get(accountId);
    return {
      accountId,
      handle,
      isShared: false,
      cursor: c?.cursor ?? 0,
      lastUsedSetTag: c?.lastUsedSetTag ?? null,
      lastUsedCategory: c?.lastUsedCategory ?? null,
      lastAdvancedAt: c?.lastAdvancedAt?.toISOString() ?? null,
    };
  });

  return NextResponse.json({ scope, rows });
}

async function getDataCursors(libraryId: string): Promise<NextResponse> {
  const library = await prisma.dataLibrary.findUnique({
    where: { id: libraryId },
    select: { id: true, name: true, rotationScope: true },
  });
  if (!library) {
    return NextResponse.json({ error: "Bibliothèque introuvable" }, { status: 404 });
  }

  const scope = (library.rotationScope ?? "shared") as "shared" | "per_account";

  if (scope === "shared") {
    const cursor = await prisma.accountDataLibraryCursor.findUnique({
      where: {
        accountId_libraryId: { accountId: SHARED_DATA_CURSOR_ACCOUNT_ID, libraryId },
      },
      select: {
        lastUsedSetTag: true,
        lastUsedCategory: true,
        lastAdvancedAt: true,
      },
    });

    return NextResponse.json({
      scope,
      rows: [
        {
          accountId: SHARED_DATA_CURSOR_ACCOUNT_ID,
          handle: null,
          isShared: true,
          lastUsedSetTag: cursor?.lastUsedSetTag ?? null,
          lastUsedCategory: cursor?.lastUsedCategory ?? null,
          lastAdvancedAt: cursor?.lastAdvancedAt?.toISOString() ?? null,
        },
      ],
    });
  }

  // per_account : comptes ayant accès à au moins une entry de la lib
  const [accountsWithAccess, existingCursors] = await Promise.all([
    prisma.instagramAccount.findMany({
      where: {
        entryAccesses: {
          some: { entry: { campaign: { libraryId } } },
        },
      },
      select: { id: true, handle: true },
      orderBy: { handle: "asc" },
    }),
    prisma.accountDataLibraryCursor.findMany({
      where: { libraryId },
      select: {
        accountId: true,
        lastUsedSetTag: true,
        lastUsedCategory: true,
        lastAdvancedAt: true,
      },
    }),
  ]);

  const cursorMap = new Map(existingCursors.map((c) => [c.accountId, c]));
  const accountSet = new Map(accountsWithAccess.map((a) => [a.id, a.handle]));

  for (const c of existingCursors) {
    if (
      !accountSet.has(c.accountId) &&
      c.accountId !== SHARED_DATA_CURSOR_ACCOUNT_ID
    ) {
      const acc = await prisma.instagramAccount.findUnique({
        where: { id: c.accountId },
        select: { id: true, handle: true },
      });
      if (acc) accountSet.set(acc.id, acc.handle);
    }
  }

  const sortedAccountIds = [...accountSet.entries()]
    .sort(([, a], [, b]) => a.localeCompare(b))
    .map(([id]) => id);

  const rows = sortedAccountIds.map((accountId) => {
    const handle = accountSet.get(accountId) ?? null;
    const c = cursorMap.get(accountId);
    return {
      accountId,
      handle,
      isShared: false,
      lastUsedSetTag: c?.lastUsedSetTag ?? null,
      lastUsedCategory: c?.lastUsedCategory ?? null,
      lastAdvancedAt: c?.lastAdvancedAt?.toISOString() ?? null,
    };
  });

  return NextResponse.json({ scope, rows });
}
