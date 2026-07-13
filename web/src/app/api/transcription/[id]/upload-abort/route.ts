/**
 * POST /api/transcription/[id]/upload-abort
 *
 * Annule un upload multipart R2 en cours pour un job de transcription et libère
 * le stockage partiel. À appeler si le client abandonne ou si l'upload échoue.
 *
 * Sécurité : auth + ownership (job.userId). `inputKey` dérivé du job.
 *
 * Corps : { uploadId: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { r2Configured } from "@/lib/r2";
import { abortMultipartUpload } from "@/lib/r2Multipart";

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
  if (!r2Configured() || !job.inputKey || job.inputKey.startsWith("local/")) {
    return NextResponse.json({ error: "Ce job n'utilise pas le stockage R2" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { uploadId?: string };
  const { uploadId } = body;

  if (!uploadId || typeof uploadId !== "string") {
    return NextResponse.json({ error: "Le champ 'uploadId' est requis" }, { status: 400 });
  }

  try {
    await abortMultipartUpload(job.inputKey, uploadId);
  } catch (err) {
    console.error(`[transcription/upload-abort] abortMultipartUpload failed key=${job.inputKey} uploadId=${uploadId}:`, err);
    return NextResponse.json({ error: "Échec de l'annulation de l'upload" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
