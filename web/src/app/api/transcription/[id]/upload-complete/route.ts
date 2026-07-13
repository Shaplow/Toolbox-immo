/**
 * POST /api/transcription/[id]/upload-complete
 *
 * Finalise un upload multipart R2 pour un job de transcription
 * (CompleteMultipartUpload). Appelé par le client après avoir uploadé toutes
 * les parties. Le job reste QUEUED — la soumission RunPod se fait plus tard via
 * /submit (qui vérifie objectExistsInR2, désormais satisfait).
 *
 * Sécurité :
 * - Auth obligatoire (getUserContext).
 * - Ownership : job.userId === effectiveUser.id (ou canAdminBypass).
 * - `inputKey` dérivé du job — jamais fourni par le client.
 * - Multipart-only : le single PUT ne passe pas ici.
 *
 * Corps : { uploadId: string, parts: { partNumber: number }[] }
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { r2Configured } from "@/lib/r2";
import { completeMultipartUpload, abortMultipartUpload } from "@/lib/r2Multipart";

export async function POST(
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
  if (job.status !== "QUEUED") {
    return NextResponse.json({ error: "Job déjà soumis ou terminé" }, { status: 409 });
  }
  if (!r2Configured()) {
    return NextResponse.json({ error: "Stockage R2 non configuré" }, { status: 503 });
  }
  if (!job.inputKey || job.inputKey.startsWith("local/")) {
    return NextResponse.json({ error: "Ce job n'utilise pas le stockage R2" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    uploadId?: string;
    parts?: { partNumber: number }[];
  };
  const { uploadId, parts } = body;

  if (!uploadId || typeof uploadId !== "string" || !Array.isArray(parts) || parts.length === 0) {
    return NextResponse.json({ error: "Champs 'uploadId' et 'parts' requis" }, { status: 400 });
  }

  try {
    await completeMultipartUpload(job.inputKey, uploadId, parts);
  } catch (err) {
    console.error(`[transcription/upload-complete] completeMultipartUpload failed key=${job.inputKey}:`, err);
    try {
      await abortMultipartUpload(job.inputKey, uploadId);
    } catch {
      /* cleanup best-effort */
    }
    return NextResponse.json(
      { error: "Échec de la finalisation de l'upload multipart" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
