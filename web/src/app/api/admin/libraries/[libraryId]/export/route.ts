/**
 * GET /api/admin/libraries/[libraryId]/export
 *
 * Exporte une bibliothèque complète sous forme de fichier ZIP.
 *
 * Query params :
 *   includeFiles=true|false   — inclure les binaires vidéo/audio (défaut: false)
 *   includeUsage=true|false   — inclure les compteurs d'utilisation (défaut: true)
 *
 * Retourne :
 *   Content-Type: application/zip
 *   Content-Disposition: attachment; filename="library-*.zip"
 *   X-Export-Warnings: JSON array de strings (si avertissements)
 *
 * Fonctionne pour MediaLibrary et DataLibrary. Si includeFiles=true sur une
 * DataLibrary, la valeur est ignorée (pas de binaires).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import { buildLibraryExport } from "@/lib/libraryExport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ libraryId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  const { libraryId } = await params;

  const url = new URL(req.url);
  const includeFiles = url.searchParams.get("includeFiles") === "true";
  const includeUsage = url.searchParams.get("includeUsage") !== "false"; // défaut: true

  let result;
  try {
    result = await buildLibraryExport(libraryId, { includeFiles, includeUsage });
  } catch (err) {
    console.error(`[admin/libraries/${libraryId}/export] build error:`, err);
    return NextResponse.json({ error: "Erreur lors de la génération du ZIP" }, { status: 500 });
  }

  if (!result) {
    return NextResponse.json({ error: "Bibliothèque introuvable" }, { status: 404 });
  }

  let zipBuffer: Buffer;
  try {
    zipBuffer = await result.zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
  } catch (err) {
    console.error(`[admin/libraries/${libraryId}/export] zip generate error:`, err);
    return NextResponse.json({ error: "Erreur lors de la compression du ZIP" }, { status: 500 });
  }

  const headers = new Headers({
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${result.filename}"`,
    "Content-Length": String(zipBuffer.length),
  });

  if (result.warnings.length > 0) {
    headers.set("X-Export-Warnings", JSON.stringify(result.warnings));
  }

  return new NextResponse(new Uint8Array(zipBuffer), { status: 200, headers });
}
