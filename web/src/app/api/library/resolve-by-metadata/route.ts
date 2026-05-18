import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { selectMediaAssetByMetadataValue } from "@/lib/contentLibraryResolver";

/**
 * GET /api/library/resolve-by-metadata
 *
 * Resolves a single MediaAsset from a library by matching a metadata field value.
 * Used by ListingForm to dynamically populate metadata-driven video fields when
 * the user changes a linked select field (e.g. "Nom du client").
 *
 * Query params:
 *   libraryId    — the MediaLibrary ID
 *   metadataKey  — the metadata field key to match (e.g. "nom_du_client")
 *   value        — the value to match (e.g. "DO AMARAL")
 *
 * Returns { id, url, filename } or null (404) if no matching asset is found.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const libraryId = searchParams.get("libraryId");
  const metadataKey = searchParams.get("metadataKey");
  const value = searchParams.get("value");
  const accountId = searchParams.get("accountId") ?? undefined;

  if (!libraryId || !metadataKey || !value) {
    return NextResponse.json({ error: "Paramètres manquants" }, { status: 400 });
  }

  const asset = await selectMediaAssetByMetadataValue(
    libraryId,
    metadataKey,
    value.trim(),
    accountId,
  );

  if (!asset) {
    return NextResponse.json(null, { status: 404 });
  }

  return NextResponse.json({ id: asset.id, url: asset.url, filename: asset.filename, metadata: asset.metadata });
}
