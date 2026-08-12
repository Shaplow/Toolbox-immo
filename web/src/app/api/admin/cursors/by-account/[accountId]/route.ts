/**
 * GET /api/admin/cursors/by-account/[accountId]
 *
 * Sprint D — Retourne tous les curseurs (Media + Data) pertinents pour un
 * compte Instagram, agrégés en une seule réponse (vue cross-libs sur la fiche
 * compte). Point unique de gestion des curseurs.
 *
 * Gestion du scope (important) :
 *  - Libs `per_account` : le curseur propre à CE compte.
 *  - Libs `shared` : le curseur GLOBAL (stocké sous la sentinelle
 *    SHARED_*_CURSOR_ACCOUNT_ID), surfacé ici flaggé `isShared` — l'ajuster/reset
 *    impacte tous les comptes. `cursorAccountId` porte la clé réelle (sentinelle
 *    en shared) pour que l'ajustement cible le bon curseur.
 *  - Transition de scope : les rows per-account d'une lib repassée en `shared`
 *    sont des reliquats → on les filtre (on ne montre que le curseur courant).
 *
 * Admin only.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import {
  SHARED_CURSOR_ACCOUNT_ID,
  SHARED_DATA_CURSOR_ACCOUNT_ID,
} from "@/lib/contentLibraryResolver";
import { resolveRotationMode } from "@/lib/rotation/rotationMode";

interface Params {
  params: Promise<{ accountId: string }>;
}

/**
 * Longueur de séquence EFFECTIVE, c'est-à-dire celle que la rotation utilise
 * réellement : 0 dès que le mode effectif n'est pas `override`. Sans ça, l'UI
 * affichait « N thèmes » sur une bibliothèque passée en auto dont la séquence
 * n'est plus lue — exactement le mensonge qui a masqué le bug de rotation.
 */
function effectiveSeqLen(lib: { rotationMode: string | null; setSequence: string } | null | undefined): number {
  if (!lib) return 0;
  const { mode, sequence } = resolveRotationMode(lib);
  return mode === "override" ? sequence.length : 0;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const ctx = await getUserContext();
  if (!ctx?.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }
  const { accountId } = await params;

  const account = await prisma.instagramAccount.findUnique({
    where: { id: accountId },
    select: { id: true, handle: true, name: true },
  });
  if (!account) {
    return NextResponse.json({ error: "Compte introuvable" }, { status: 404 });
  }

  const [
    mediaCursorsRaw,
    dataCursorsRaw,
    sharedMediaLibs,
    sharedDataLibs,
  ] = await Promise.all([
    prisma.accountLibraryCursor.findMany({
      where: { accountId },
      include: {
        library: {
          select: { id: true, name: true, type: true, rotationScope: true, setSequence: true, rotationMode: true },
        },
      },
    }),
    prisma.accountDataLibraryCursor.findMany({
      where: { accountId },
      include: {
        library: {
          select: { id: true, name: true, templateType: true, rotationScope: true },
        },
      },
    }),
    prisma.mediaLibrary.findMany({
      where: { rotationScope: "shared" },
      select: { id: true, name: true, type: true, setSequence: true, rotationMode: true },
    }),
    prisma.dataLibrary.findMany({
      where: { rotationScope: "shared" },
      select: { id: true, name: true, templateType: true },
    }),
  ]);

  // Curseurs partagés (sous la sentinelle) pour les libs shared.
  const [sharedMediaCursors, sharedDataCursors] = await Promise.all([
    sharedMediaLibs.length
      ? prisma.accountLibraryCursor.findMany({
          where: {
            accountId: SHARED_CURSOR_ACCOUNT_ID,
            libraryId: { in: sharedMediaLibs.map((l) => l.id) },
          },
        })
      : Promise.resolve([]),
    sharedDataLibs.length
      ? prisma.accountDataLibraryCursor.findMany({
          where: {
            accountId: SHARED_DATA_CURSOR_ACCOUNT_ID,
            libraryId: { in: sharedDataLibs.map((l) => l.id) },
          },
        })
      : Promise.resolve([]),
  ]);
  const sharedMediaMap = new Map(sharedMediaCursors.map((c) => [c.libraryId, c]));
  const sharedDataMap = new Map(sharedDataCursors.map((c) => [c.libraryId, c]));

  // ── Media ──
  const perAccountMedia = mediaCursorsRaw
    // Reliquats : une lib repassée en shared garde des rows per-account inutiles.
    .filter((c) => (c.library?.rotationScope ?? "per_account") !== "shared")
    .map((c) => ({
      id: c.id,
      libraryId: c.libraryId,
      libraryName: c.library?.name ?? "—",
      libraryType: c.library?.type ?? "video",
      cursor: c.cursor,
      lastUsedSetTag: c.lastUsedSetTag,
      lastUsedCategory: c.lastUsedCategory,
      lastAdvancedAt: c.lastAdvancedAt?.toISOString() ?? null,
      rotationScope: "per_account",
      cursorAccountId: c.accountId,
      sequenceLength: effectiveSeqLen(c.library),
    }));

  const sharedMedia = sharedMediaLibs.map((lib) => {
    const c = sharedMediaMap.get(lib.id);
    return {
      id: c?.id ?? `shared-media-${lib.id}`,
      libraryId: lib.id,
      libraryName: lib.name,
      libraryType: lib.type,
      cursor: c?.cursor ?? 0,
      lastUsedSetTag: c?.lastUsedSetTag ?? null,
      lastUsedCategory: c?.lastUsedCategory ?? null,
      lastAdvancedAt: c?.lastAdvancedAt?.toISOString() ?? null,
      rotationScope: "shared",
      cursorAccountId: SHARED_CURSOR_ACCOUNT_ID,
      sequenceLength: effectiveSeqLen(lib),
    };
  });

  // ── Data ──
  const perAccountData = dataCursorsRaw
    .filter((c) => (c.library?.rotationScope ?? "per_account") !== "shared")
    .map((c) => ({
      id: c.id,
      libraryId: c.libraryId,
      libraryName: c.library?.name ?? "—",
      templateType: c.library?.templateType ?? "?",
      lastUsedSetTag: c.lastUsedSetTag,
      lastUsedCategory: c.lastUsedCategory,
      lastAdvancedAt: c.lastAdvancedAt?.toISOString() ?? null,
      rotationScope: "per_account",
      cursorAccountId: c.accountId,
    }));

  const sharedData = sharedDataLibs.map((lib) => {
    const c = sharedDataMap.get(lib.id);
    return {
      id: c?.id ?? `shared-data-${lib.id}`,
      libraryId: lib.id,
      libraryName: lib.name,
      templateType: lib.templateType ?? "?",
      lastUsedSetTag: c?.lastUsedSetTag ?? null,
      lastUsedCategory: c?.lastUsedCategory ?? null,
      lastAdvancedAt: c?.lastAdvancedAt?.toISOString() ?? null,
      rotationScope: "shared",
      cursorAccountId: SHARED_DATA_CURSOR_ACCOUNT_ID,
    };
  });

  return NextResponse.json({
    account,
    mediaCursors: [...sharedMedia, ...perAccountMedia],
    dataCursors: [...sharedData, ...perAccountData],
  });
}
