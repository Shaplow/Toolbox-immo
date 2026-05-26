/**
 * PUT /api/transcription/[id]/upload-local
 *
 * Endpoint de substitution à la presigned URL R2 en mode local (dev).
 * Le browser envoie le fichier audio/vidéo en PUT avec le corps brut
 * (même XHR que pour R2), et il est sauvegardé dans public/.
 *
 * Réservé aux jobs dont inputKey commence par "local/".
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import path from "path";
import { mkdir, rename, unlink } from "fs/promises";
import { createWriteStream } from "fs";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await params;

  const job = await prisma.transcriptionJob.findUnique({ where: { id } });
  if (!job) {
    return NextResponse.json({ error: "Job introuvable" }, { status: 404 });
  }
  if (job.userId !== userContext.effectiveUser.id && !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }
  if (!job.inputKey?.startsWith("local/")) {
    return NextResponse.json(
      { error: "Ce job n'utilise pas le stockage local" },
      { status: 400 }
    );
  }
  if (job.status !== "QUEUED") {
    return NextResponse.json(
      { error: "Job déjà soumis ou terminé" },
      { status: 409 }
    );
  }
  if (!req.body) {
    return NextResponse.json({ error: "Corps de requête manquant" }, { status: 400 });
  }

  const relPath  = job.inputKey.replace(/^local\//, "");
  const destPath = path.join(process.cwd(), "public", relPath);
  const tempPath = `${destPath}.part`;

  try {
    await mkdir(path.dirname(destPath), { recursive: true });
    const nodeStream = Readable.fromWeb(req.body as import("stream/web").ReadableStream<Uint8Array>);
    await pipeline(nodeStream, createWriteStream(tempPath));
    await rename(tempPath, destPath);
  } catch (err) {
    console.error("[transcription/upload-local] Write failed:", err);
    await unlink(tempPath).catch(() => undefined);
    return NextResponse.json({ error: "Échec de l'écriture locale" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
