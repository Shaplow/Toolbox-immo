import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { canManageMediaLibraries } from "@/lib/permissions/mediaLibrary";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/admin/libraries/media/[id]/ig-accounts
 *
 * Retourne les comptes Instagram ayant au moins un asset dans la bibliothèque
 * dont les tags contiennent le handle du compte. Utilisé pour peupler
 * dynamiquement un champ "select" de type optionsSource="ig-accounts-from-library".
 */
export async function GET(_req: Request, { params }: Params) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  if (!canManageMediaLibraries(auth.ctx.effectiveUser.role)) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const { id: libraryId } = await params;

  // Récupère tous les handles des comptes IG actifs (exclut les sentinels shared)
  const accounts = await prisma.instagramAccount.findMany({
    where: { id: { notIn: ["__shared__", "__shared__data__"] } },
    select: { id: true, handle: true, name: true },
    orderBy: { name: "asc" },
  });

  if (accounts.length === 0) {
    return NextResponse.json({ accounts: [] });
  }

  // Récupère les tags de tous les assets de cette bibliothèque
  const assets = await prisma.mediaAsset.findMany({
    where: { libraryId },
    select: { tags: true },
  });

  if (assets.length === 0) {
    return NextResponse.json({ accounts: [] });
  }

  // Parse les tags et construit un Set de tous les tags présents dans la lib
  const tagsInLib = new Set<string>();
  for (const asset of assets) {
    try {
      const parsed = JSON.parse(asset.tags) as unknown;
      if (Array.isArray(parsed)) {
        for (const tag of parsed) {
          if (typeof tag === "string") tagsInLib.add(tag.toLowerCase());
        }
      }
    } catch {
      // skip malformed
    }
  }

  // Filtre les comptes dont le handle est présent dans les tags de la lib
  const matched = accounts
    .filter((acc) => tagsInLib.has(acc.handle.toLowerCase()))
    .map((acc) => ({ id: acc.id, handle: acc.handle, name: acc.name }));

  return NextResponse.json({ accounts: matched });
}
