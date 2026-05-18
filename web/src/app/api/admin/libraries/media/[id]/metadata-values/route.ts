import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/admin/libraries/media/[id]/metadata-values?key=<metadataKey>
 *
 * Retourne les valeurs distinctes et non-nulles d'un champ de métadonnée
 * pour tous les assets actifs de la bibliothèque. Utilisé pour peupler
 * dynamiquement un champ "select" de type optionsSource="metadata-values-from-library".
 */
export async function GET(req: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const { id: libraryId } = await params;
  const { searchParams } = new URL(req.url);
  const metadataKey = searchParams.get("key");

  if (!metadataKey || metadataKey.trim() === "") {
    return NextResponse.json({ error: "Paramètre 'key' requis" }, { status: 400 });
  }

  // Vérifier que la bibliothèque existe
  const library = await prisma.mediaLibrary.findUnique({
    where: { id: libraryId },
    select: { id: true },
  });
  if (!library) {
    return NextResponse.json({ error: "Bibliothèque introuvable" }, { status: 404 });
  }

  // Récupère les métadonnées de tous les assets actifs de la bibliothèque
  const assets = await prisma.mediaAsset.findMany({
    where: { libraryId, disabled: false },
    select: { metadata: true },
  });

  // Extrait les valeurs distinctes non-nulles pour la clé demandée
  const seen = new Set<string>();
  for (const asset of assets) {
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(asset.metadata ?? "{}") as Record<string, unknown>;
    } catch {
      continue;
    }
    const val = meta[metadataKey];
    if (val !== undefined && val !== null && val !== "") {
      seen.add(String(val));
    }
  }

  const values = Array.from(seen).sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }));
  return NextResponse.json({ values });
}
