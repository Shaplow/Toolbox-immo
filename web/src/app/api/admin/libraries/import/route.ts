/**
 * POST /api/admin/libraries/import
 *
 * Importe une bibliothèque depuis un fichier ZIP exporté par l'API export.
 *
 * Body : multipart/form-data
 *   file           File (zip)   — obligatoire
 *   mode           string       — "new" (défaut) | "merge"
 *   targetLibraryId string      — requis si mode=merge
 *   includeUsage   string       — "true" (défaut) | "false"
 *   includeAccess  string       — "true" (défaut) | "false"
 *
 * Réponse :
 *   201  { libraryId, libraryName, created, skipped, warnings[] }
 *   400  { error }
 *   403  { error }
 *   404  { error }  — targetLibraryId introuvable
 *   422  { error }  — manifest invalide
 *   500  { error }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { importLibraryFromZip } from "@/lib/libraryImport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ZIP_SIZE_BYTES = parseInt(process.env.LIBRARY_IMPORT_MAX_SIZE ?? "") || 10 * 1024 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Corps multipart/form-data invalide" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "Champ 'file' requis (ZIP)" }, { status: 400 });
  }

  const f = file as File;

  if (!f.name.toLowerCase().endsWith(".zip")) {
    return NextResponse.json({ error: "Le fichier doit être un ZIP (.zip)" }, { status: 400 });
  }

  if (f.size > MAX_ZIP_SIZE_BYTES) {
    const maxGB = Math.round(MAX_ZIP_SIZE_BYTES / 1024 / 1024 / 1024);
    return NextResponse.json(
      { error: `Fichier trop volumineux. Maximum : ${maxGB} GB.` },
      { status: 400 }
    );
  }

  // Lire les options
  const mode = formData.get("mode") === "merge" ? "merge" : "new";
  const targetLibraryId = (formData.get("targetLibraryId") as string | null) ?? undefined;
  const includeUsage = formData.get("includeUsage") !== "false";
  const includeAccess = formData.get("includeAccess") !== "false";

  if (mode === "merge" && !targetLibraryId) {
    return NextResponse.json(
      { error: "targetLibraryId est requis en mode merge" },
      { status: 400 }
    );
  }

  // Lire le buffer du ZIP
  let zipBuffer: Buffer;
  try {
    const arrayBuffer = await f.arrayBuffer();
    zipBuffer = Buffer.from(arrayBuffer);
  } catch {
    return NextResponse.json({ error: "Impossible de lire le fichier ZIP" }, { status: 400 });
  }

  try {
    const result = await importLibraryFromZip(zipBuffer, {
      mode,
      targetLibraryId,
      includeUsage,
      includeAccess,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";

    if (
      message.includes("manifest.json") ||
      message.includes("libraryType") ||
      message.includes("version")
    ) {
      return NextResponse.json({ error: message }, { status: 422 });
    }

    if (message.includes("introuvable")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }

    console.error("[admin/libraries/import] error:", err);
    return NextResponse.json({ error: "Erreur serveur lors de l'import" }, { status: 500 });
  }
}
