/**
 * GET /api/admin/cursors/by-account/[accountId]
 *
 * Sprint D — Retourne tous les curseurs (Media + Data) d'un compte
 * Instagram donné, agrégés en une seule réponse. Permet d'afficher une
 * vue cross-libs sur la fiche compte sans naviguer lib par lib.
 *
 * Admin only.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

interface Params {
  params: Promise<{ accountId: string }>;
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

  // Fetch parallèle des curseurs Media + Data + des libs liées.
  const [mediaCursors, dataCursors] = await Promise.all([
    prisma.accountLibraryCursor.findMany({
      where: { accountId },
      include: {
        library: {
          select: {
            id: true,
            name: true,
            type: true,
            rotationScope: true,
            setSequence: true,
          },
        },
      },
    }),
    prisma.accountDataLibraryCursor.findMany({
      where: { accountId },
      include: {
        library: {
          select: {
            id: true,
            name: true,
            templateType: true,
            rotationScope: true,
          },
        },
      },
    }),
  ]);

  return NextResponse.json({
    account,
    mediaCursors: mediaCursors.map((c) => ({
      id: c.id,
      libraryId: c.libraryId,
      libraryName: c.library?.name ?? "—",
      libraryType: c.library?.type ?? "video",
      cursor: c.cursor,
      lastUsedSetTag: c.lastUsedSetTag,
      lastUsedCategory: c.lastUsedCategory,
      lastAdvancedAt: c.lastAdvancedAt?.toISOString() ?? null,
      rotationScope: c.library?.rotationScope ?? "per_account",
      sequenceLength: (() => {
        try {
          return c.library?.setSequence
            ? ((JSON.parse(c.library.setSequence) as string[]) ?? []).filter(Boolean)
                .length
            : 0;
        } catch {
          return 0;
        }
      })(),
    })),
    dataCursors: dataCursors.map((c) => ({
      id: c.id,
      libraryId: c.libraryId,
      libraryName: c.library?.name ?? "—",
      templateType: c.library?.templateType ?? "?",
      lastUsedSetTag: c.lastUsedSetTag,
      lastUsedCategory: c.lastUsedCategory,
      lastAdvancedAt: c.lastAdvancedAt?.toISOString() ?? null,
      rotationScope: c.library?.rotationScope ?? "per_account",
    })),
  });
}
