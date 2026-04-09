/**
 * GET /api/transcription/[id]/download?format=srt|json|chunks
 *
 * Génère et retourne les sorties d'une transcription complétée.
 *
 * Formats :
 *   srt    (défaut) — fichier SRT standard, compatible éditeur captions
 *   json             — JSON brut des segments (depuis R2)
 *   chunks           — ZIP contenant les fichiers chunks ~9000 tokens pour IA
 *
 * Paramètre supplémentaire pour chunks :
 *   ?stem=nom        — préfixe pour les noms de fichiers (défaut : nom du fichier source)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getFromR2 } from "@/lib/r2";
import {
  generateSrt,
  generateChunks,
  type Segment,
} from "@/lib/transcriptionProcess";
import JSZip from "jszip";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await params;
  const url = new URL(req.url);
  const format = (url.searchParams.get("format") ?? "srt").toLowerCase();

  const job = await prisma.transcriptionJob.findUnique({ where: { id } });
  if (!job) {
    return NextResponse.json({ error: "Job introuvable" }, { status: 404 });
  }
  if (job.userId !== session.user.id && session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }
  if (job.status !== "COMPLETED") {
    return NextResponse.json({ error: "Transcription non terminée" }, { status: 409 });
  }
  if (!job.outputJsonKey) {
    return NextResponse.json({ error: "Fichier de sortie introuvable en R2" }, { status: 404 });
  }

  // ─── Charger les segments depuis R2 ──────────────────────────────────────
  let segments: Segment[];
  try {
    const buf = await getFromR2(job.outputJsonKey);
    segments = JSON.parse(buf.toString("utf-8")) as Segment[];
  } catch (err) {
    console.error("[transcription/download] Erreur lecture R2:", err);
    return NextResponse.json({ error: "Impossible de lire les données de transcription" }, { status: 500 });
  }

  const stem = (url.searchParams.get("stem") ?? job.inputFilename?.replace(/\.[^.]+$/, "") ?? "transcription")
    .replace(/[^\w\-. ]/g, "_")
    .trim();

  // ─── SRT (défaut) ─────────────────────────────────────────────────────────
  if (format === "srt") {
    const srtContent = generateSrt(segments);
    return new NextResponse(srtContent, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${stem}.srt"`,
      },
    });
  }

  // ─── JSON brut ────────────────────────────────────────────────────────────
  if (format === "json") {
    const jsonContent = JSON.stringify(segments, null, 2);
    return new NextResponse(jsonContent, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${stem}_segments.json"`,
      },
    });
  }

  // ─── Chunks IA (ZIP) ─────────────────────────────────────────────────────
  if (format === "chunks") {
    const chunkFiles = generateChunks(segments, undefined, undefined, stem);
    if (chunkFiles.length === 0) {
      return NextResponse.json(
        { error: "Aucun contenu éditorial trouvé pour générer des chunks" },
        { status: 422 }
      );
    }

    const zip = new JSZip();
    for (const file of chunkFiles) {
      zip.file(file.filename, file.content, { binary: false });
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

    return new NextResponse(new Uint8Array(zipBuffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${stem}_chunks.zip"`,
      },
    });
  }

  return NextResponse.json(
    { error: `Format non reconnu : ${format}. Valeurs possibles : srt, json, chunks` },
    { status: 400 }
  );
}
