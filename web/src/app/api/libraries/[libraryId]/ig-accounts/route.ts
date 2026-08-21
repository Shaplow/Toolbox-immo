import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import { SHARED_SENTINEL_IDS } from "@/lib/rotation/sentinels";

type Params = { params: Promise<{ libraryId: string }> };

/**
 * GET /api/libraries/[libraryId]/ig-accounts
 *
 * Retourne les comptes Instagram ayant au moins un asset dans la bibliothèque
 * dont les tags contiennent le handle du compte. Utilisé pour peupler
 * dynamiquement un champ "select" de type optionsSource="ig-accounts-from-library"
 * dans le formulaire de génération.
 *
 * B.2 (P6 hardening, 21/08) — miroir non-admin de
 * `/api/admin/libraries/media/[id]/ig-accounts` : `SelectFieldInput`
 * (FieldInputs.tsx) appelait la route ADMIN pour peupler ce select, ce qui
 * renvoyait un 401/403 silencieux pour tout user non-admin utilisant le
 * formulaire de génération — select bloqué sur « Chargement… » à l'infini.
 * Auth-gated (requireUser, PAS admin) — même niveau d'exposition que
 * `/api/libraries/[libraryId]/assets` (déjà auth-only) et que la liste des
 * comptes IG déjà transmise sans restriction de rôle à `ListingForm`
 * (`generate/[templateId]/page.tsx`, prop `instagramAccounts`).
 */
export async function GET(_req: Request, { params }: Params) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  const { libraryId } = await params;

  // Récupère tous les handles des comptes IG actifs (exclut les sentinels shared)
  const accounts = await prisma.instagramAccount.findMany({
    where: { id: { notIn: [...SHARED_SENTINEL_IDS] } },
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
