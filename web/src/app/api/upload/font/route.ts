import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { uploadToR2, r2Configured } from "@/lib/r2";
import { upsertFontAsset, inferWeightFromFilename, inferStyleFromFilename } from "@/lib/fontAssets";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

const ALLOWED_EXTS = [".woff", ".woff2", ".ttf", ".otf"];
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

const MIME_BY_EXT: Record<string, string> = {
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

export async function POST(req: NextRequest) {
  try {
    const userContext = await getUserContext();
    if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }

    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "Aucun fichier fourni" }, { status: 400 });
    }

    const filename = (file as File).name;
    const ext = path.extname(filename).toLowerCase();

    if (!ALLOWED_EXTS.includes(ext)) {
      return NextResponse.json(
        { error: `Extension non supportée. Formats acceptés : ${ALLOWED_EXTS.join(", ")}` },
        { status: 400 }
      );
    }

    const bytes = await (file as File).arrayBuffer();
    if (bytes.byteLength > MAX_SIZE_BYTES) {
      return NextResponse.json({ error: "Fichier trop volumineux (max 10 Mo)" }, { status: 400 });
    }

    // Sanitize filename
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const family = path.basename(filename, ext).replace(/[-_]+/g, " ").trim();
    const buffer = Buffer.from(bytes);
    const contentType = MIME_BY_EXT[ext] ?? "application/octet-stream";
    let url = "";
    let storageKey: string | null = null;

    // ─── R2 si configuré ET mode RunPod, sinon fallback local ────────────────
    const useRunpod = process.env.USE_RUNPOD !== "false";
    if (useRunpod && r2Configured()) {
      storageKey = `fonts/${safe}`;
      const result = await uploadToR2(storageKey, buffer, contentType);
      url = result.url;
    } else {
      // Fallback : stockage local
      const fontsDir = path.join(process.cwd(), "public", "fonts");
      await mkdir(fontsDir, { recursive: true });
      const filePath = path.join(fontsDir, safe);
      await writeFile(filePath, buffer);
      storageKey = `fonts/${safe}`;
      url = `/fonts/${safe}`;
    }

    const asset = await upsertFontAsset({
      family,
      weight: inferWeightFromFilename(filename),
      fontStyle: inferStyleFromFilename(filename),
      url,
      storageKey,
      originalName: filename,
    });

    return NextResponse.json({ url: asset.url, name: safe, family: asset.family, asset });
  } catch (err) {
    console.error("Font upload error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
