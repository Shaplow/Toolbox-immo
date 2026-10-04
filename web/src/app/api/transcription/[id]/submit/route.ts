/**
 * POST /api/transcription/[id]/submit
 *
 * Soumet un TranscriptionJob en attente (QUEUED) au moteur de transcription.
 * Appeler après que le navigateur a uploadé le fichier source (URL pré-signée
 * R2 ou upload-local en dev).
 *
 * La logique vit dans `lib/services/transcription/submitTranscription.ts`,
 * partagée avec le lancement en lot :
 * - vérifications AVANT le claim (un upload encore en cours renvoie 409
 *   UPLOAD_PENDING sans toucher au job) ;
 * - RunPod : envoi en fond, réponse 202 immédiate ;
 * - mode local (sans R2) : transcription attendue, 200 ou 502.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import { r2Configured } from "@/lib/r2";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";
import {
  claimTranscriptionForSubmit,
  dispatchTracked,
} from "@/lib/services/transcription/submitTranscription";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;

  const { id } = await params;

  const job = await prisma.transcriptionJob.findUnique({ where: { id } });
  if (!job) {
    return NextResponse.json({ error: "Job introuvable" }, { status: 404 });
  }
  if (job.userId !== userContext.effectiveUser.id && !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  let claimed;
  try {
    claimed = await claimTranscriptionForSubmit(job);
  } catch (err) {
    return mapServiceError(err);
  }

  // Mode local (dev) : la transcription est attendue, comme avant l'extraction.
  if (!r2Configured()) {
    const result = await dispatchTracked(claimed);
    if (!result.ok) {
      return NextResponse.json(
        { error: `Erreur transcription locale : ${result.error}` },
        { status: 502 }
      );
    }
    return NextResponse.json({ jobId: job.id });
  }

  // RunPod : envoi EN FOND — ne bloque pas la requête sur un éventuel cold-start
  // pod. Le process Node est persistant (PM2), le travail de fond survit à la
  // réponse ; le webhook remonte la suite.
  void dispatchTracked(claimed);
  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
