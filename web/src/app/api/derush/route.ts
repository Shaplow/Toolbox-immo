/**
 * POST /api/derush
 * Crée un DerushJob et retourne les URLs pré-signées pour l'upload des vidéos.
 *
 * Body :
 *   files                      : { filename, ext, contentType }[]  — fichiers vidéo
 *   analysisMode               : "vision" | "transcription"
 *   presetId?                  : string
 *   visionProvider?            : "heuristic" | "gemini" | "openai" | "claude"
 *   transcriptionJobId?        : string  (réutiliser un TranscriptionJob existant)
 *   transcriptionInputFilename?: string  (upload SRT/JSON)
 *   transcriptionInputExt?     : string
 *
 * Réponse 202 :
 *   { jobId, uploadUrls, transcriptionUploadUrl? }
 *
 * GET /api/derush
 * Liste les 50 derniers jobs de l'utilisateur.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createPresignedUploadUrl, r2Configured } from "@/lib/r2";
import { hasTool, TOOLS } from "@/lib/permissions";
import type { DerushJobCreatePayload } from "@/types/derush";

const VIDEO_EXTENSIONS = new Set([
  "mp4", "mov", "mkv", "webm", "avi", "mts", "m2ts", "mxf",
]);

const TRANSCRIPTION_EXTENSIONS = new Set(["srt", "json", "vtt"]);

// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  if (session.user.role !== "ADMIN") {
    if (!(await hasTool(session.user.id, TOOLS.DERUSH))) {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }
  }

  if (!r2Configured()) {
    return NextResponse.json({ error: "R2 non configuré" }, { status: 503 });
  }

  let body: DerushJobCreatePayload;
  try {
    body = await req.json() as DerushJobCreatePayload;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  // ─── Validation ──────────────────────────────────────────────────────────
  if (!Array.isArray(body.files) || body.files.length === 0) {
    return NextResponse.json({ error: "Au moins un fichier vidéo est requis" }, { status: 400 });
  }
  if (body.files.length > 20) {
    return NextResponse.json({ error: "Maximum 20 fichiers par job" }, { status: 400 });
  }

  const analysisMode = body.analysisMode === "transcription" ? "transcription" : "vision";

  for (const f of body.files) {
    const ext = (f.ext ?? "").toLowerCase().replace(/^\./, "");
    if (!VIDEO_EXTENSIONS.has(ext)) {
      return NextResponse.json(
        { error: `Extension non supportée : .${ext}` },
        { status: 400 }
      );
    }
  }

  // ─── Vérification transcriptionJobId ─────────────────────────────────────
  if (body.transcriptionJobId) {
    const tJob = await prisma.transcriptionJob.findUnique({
      where: { id: body.transcriptionJobId },
    });
    if (!tJob || tJob.userId !== session.user.id) {
      return NextResponse.json(
        { error: "TranscriptionJob introuvable ou accès refusé" },
        { status: 404 }
      );
    }
  }

  const userId = session.user.id;
  const ts = Date.now();

  // ─── Presigned upload URLs pour les vidéos ────────────────────────────────
  const inputFiles: { key: string; filename: string }[] = [];
  const uploadUrls: string[] = [];

  for (let i = 0; i < body.files.length; i++) {
    const f = body.files[i];
    const ext = (f.ext ?? "").toLowerCase().replace(/^\./, "");
    const key = `derush/${userId}/${ts}/source_${String(i).padStart(2, "0")}.${ext}`;
    inputFiles.push({ key, filename: f.filename });
    const url = await createPresignedUploadUrl(key, f.contentType || "video/mp4", 3600);
    uploadUrls.push(url);
  }

  // ─── Presigned URL pour transcription input SRT/JSON (optionnel) ─────────
  let transcriptionInputKey: string | undefined;
  let transcriptionUploadUrl: string | undefined;

  if (body.transcriptionInputFilename && body.transcriptionInputExt) {
    const ext = (body.transcriptionInputExt ?? "").toLowerCase().replace(/^\./, "");
    if (TRANSCRIPTION_EXTENSIONS.has(ext)) {
      transcriptionInputKey = `derush/${userId}/${ts}/transcription_input.${ext}`;
      const mime = ext === "srt" ? "text/plain" : "application/json";
      transcriptionUploadUrl = await createPresignedUploadUrl(
        transcriptionInputKey,
        mime,
        3600
      );
    }
  }

  // ─── Créer le job en DB ───────────────────────────────────────────────────
  const job = await prisma.derushJob.create({
    data: {
      userId,
      status: "QUEUED",
      analysisMode,
      inputFiles: JSON.stringify(inputFiles),
      transcriptionJobId: body.transcriptionJobId ?? null,
      transcriptionInputKey: transcriptionInputKey ?? null,
      presetId: body.presetId ?? null,
      formatId: body.formatId ?? null,
      enableDiarization: body.enableDiarization ?? false,
      visionProvider: body.visionProvider ?? "heuristic",
    },
  });

  return NextResponse.json(
    {
      jobId: job.id,
      uploadUrls,
      ...(transcriptionUploadUrl ? { transcriptionUploadUrl } : {}),
    },
    { status: 202 }
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const isAdmin = session.user.role === "ADMIN";

  const jobs = await prisma.derushJob.findMany({
    where: isAdmin ? undefined : { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { preset: { select: { id: true, name: true } }, format: { select: { id: true, name: true } } },
  });

  return NextResponse.json(
    jobs.map((j) => ({
      id: j.id,
      status: j.status,
      analysisMode: j.analysisMode,
      visionProvider: j.visionProvider,
      segmentCount: j.segmentCount,
      totalDuration: j.totalDuration,
      presetId: j.presetId,
      presetName: j.preset?.name ?? null,
      formatId: j.formatId,
      formatName: j.format?.name ?? null,
      fileCount: (JSON.parse(j.inputFiles) as unknown[]).length,
      createdAt: j.createdAt.toISOString(),
    }))
  );
}
