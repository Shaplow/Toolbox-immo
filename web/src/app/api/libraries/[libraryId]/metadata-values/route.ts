import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ libraryId: string }> };

/**
 * GET /api/libraries/[libraryId]/metadata-values?key=<metadataKey>
 *
 * Retourne les valeurs distinctes et non-nulles d'un champ de métadonnée pour
 * tous les assets actifs de la bibliothèque. Utilisé pour peupler
 * dynamiquement un champ "select" de type optionsSource="metadata-values-from-library"
 * dans le formulaire de génération.
 *
 * B.2 (P6 hardening, 21/08) — miroir non-admin de
 * `/api/admin/libraries/media/[id]/metadata-values` : `SelectFieldInput`
 * (FieldInputs.tsx) appelait la route ADMIN pour peupler ce select, ce qui
 * renvoyait un 401/403 silencieux pour tout user non-admin — select bloqué
 * sur « Chargement… » à l'infini. Auth-gated (requireUser, PAS admin) — même
 * niveau d'exposition que `/api/libraries/[libraryId]/assets` (déjà
 * auth-only), qui expose déjà les mêmes assets de cette bibliothèque.
 */
export async function GET(req: Request, { params }: Params) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  const { libraryId } = await params;
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
