/**
 * POST /api/admin/libraries/media/assets/download-urls
 *
 * Renvoie les URLs de téléchargement pré-signées (1h) d'un lot d'assets, en une
 * seule requête. Le navigateur télécharge ensuite chaque fichier directement
 * depuis R2 — aucun octet ne transite par le serveur, contrairement à un zip
 * serveur qui chargerait tous les binaires en mémoire (cf. `lib/libraryExport.ts`,
 * acceptable pour un export admin ponctuel mais pas pour un lot de rushs vidéo).
 *
 * Pendant du GET unitaire `media/assets/[assetId]`, et décalque de
 * `api/publications/[id]/rushes/download-urls`. Différence : les rushs sont
 * scopés par un slot parent (donc GET sans corps), ici les ids sont arbitraires
 * — d'où le POST.
 *
 * Auth : `canViewMediaLibrary` — le MONTEUR télécharge sans rien pouvoir muter.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { canViewMediaLibrary } from "@/lib/permissions/mediaLibrary";
import { prisma } from "@/lib/prisma";
import { createPresignedDownloadUrl, r2Configured } from "@/lib/r2";

/**
 * Plafond par appel. Aligné sur le plafond côté client : au-delà, le gestionnaire
 * de téléchargements du navigateur décroche de toute façon, et on signerait des
 * URLs pour des fichiers qui ne partiraient jamais.
 */
const MAX_ASSETS_PER_BATCH = 25;

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  if (!canViewMediaLibrary(auth.ctx.effectiveUser.role)) {
    return NextResponse.json({ error: "Réservé aux rôles médiathèque" }, { status: 403 });
  }

  let body: { assetIds?: unknown };
  try {
    body = (await req.json()) as { assetIds?: unknown };
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide" }, { status: 400 });
  }

  const assetIds = Array.isArray(body.assetIds)
    ? body.assetIds.filter((id): id is string => typeof id === "string" && id.length > 0)
    : null;

  if (!assetIds || assetIds.length === 0) {
    return NextResponse.json({ error: "Aucun fichier à télécharger." }, { status: 400 });
  }
  if (assetIds.length > MAX_ASSETS_PER_BATCH) {
    return NextResponse.json(
      { error: `Maximum ${MAX_ASSETS_PER_BATCH} fichiers par téléchargement. Réduis ta sélection.` },
      { status: 400 },
    );
  }

  // Dédoublonne : une sélection peut contenir deux fois le même asset (via un
  // groupe + une sélection manuelle) — inutile de signer deux fois.
  const uniqueIds = [...new Set(assetIds)];

  let assets;
  try {
    assets = await prisma.mediaAsset.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, r2Key: true, filename: true, url: true },
    });
  } catch (err) {
    console.error("[media/assets/download-urls] findMany error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }

  if (assets.length === 0) {
    return NextResponse.json({ error: "Aucun fichier trouvé." }, { status: 404 });
  }

  // Dev sans R2 : l'URL publique fait office de lien de téléchargement, comme
  // dans le GET unitaire.
  if (!r2Configured()) {
    return NextResponse.json({
      assets: assets.map((a) => ({ id: a.id, filename: a.filename, url: a.url })),
    });
  }

  try {
    const signed = await Promise.all(
      assets.map(async (asset) => ({
        id: asset.id,
        filename: asset.filename,
        url: await createPresignedDownloadUrl(asset.r2Key, asset.filename, 3600),
      })),
    );
    return NextResponse.json({ assets: signed });
  } catch (err) {
    console.error("[media/assets/download-urls] presign error:", err);
    return NextResponse.json(
      { error: "Impossible de générer les URLs de téléchargement" },
      { status: 500 },
    );
  }
}
