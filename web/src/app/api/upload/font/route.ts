import { NextRequest, NextResponse } from "next/server";
import { uploadToR2, r2Configured } from "@/lib/r2";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

const ALLOWED_EXTS = [".woff", ".woff2", ".ttf", ".otf"];
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(req: NextRequest) {
  try {
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
    const buffer = Buffer.from(bytes);

    // ─── R2 si configuré, sinon fallback local ────────────────────────────
    if (r2Configured()) {
      const key = `fonts/${safe}`;
      const result = await uploadToR2(key, buffer, "font/otf");
      return NextResponse.json({ url: result.url, name: safe });
    }

    // Fallback : stockage local
    const fontsDir = path.join(process.cwd(), "public", "fonts");
    await mkdir(fontsDir, { recursive: true });
    const filePath = path.join(fontsDir, safe);
    await writeFile(filePath, buffer);
    return NextResponse.json({ url: `/fonts/${safe}`, name: safe });
  } catch (err) {
    console.error("Font upload error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
