/**
 * POST /api/transcription/[id]/upload-complete
 *
 * Confirme l'upload du média source d'un job de transcription et pose
 * `uploadedAt`. Appelé par le client à la fin de CHAQUE upload R2 :
 *
 * - multipart (corps `{ uploadId, parts }`) : finalise l'upload
 *   (CompleteMultipartUpload) ;
 * - PUT unique (corps vide `{}`) : vérifie par HEAD que l'objet est bien arrivé.
 *
 * `uploadedAt` distingue un job QUEUED « prêt à lancer » d'un upload en vol ou
 * abandonné : le lancement en lot ne vise que les jobs prêts, et les règles
 * d'âge (lib/transcription/staleRules.ts) ne tuent plus une vidéo prête.
 *
 * Le job reste QUEUED — la soumission se fait plus tard via /submit ou le
 * lancement du lot.
 *
 * Sécurité :
 * - Auth obligatoire (getUserContext).
 * - Ownership : job.userId === effectiveUser.id (ou canAdminBypass).
 * - `inputKey` dérivé du job — jamais fourni par le client.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import { objectExistsInR2, r2Configured } from "@/lib/r2";
import { completeMultipartUpload, abortMultipartUpload } from "@/lib/r2Multipart";

export async function POST(
  req: NextRequest,
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
  if (job.status !== "QUEUED") {
    return NextResponse.json({ error: "Job déjà soumis ou terminé" }, { status: 409 });
  }
  if (!r2Configured()) {
    return NextResponse.json({ error: "Stockage R2 non configuré" }, { status: 503 });
  }
  if (!job.inputKey || job.inputKey.startsWith("local/")) {
    return NextResponse.json({ error: "Ce job n'utilise pas le stockage R2" }, { status: 400 });
  }
  // Idempotent : une confirmation rejouée (réponse perdue, réessai) ne refait rien.
  if (job.uploadedAt) {
    return NextResponse.json({ ok: true, uploadedAt: job.uploadedAt.toISOString() });
  }

  const body = (await req.json().catch(() => ({}))) as {
    uploadId?: unknown;
    parts?: unknown;
  };
  const isMultipart = body.uploadId !== undefined || body.parts !== undefined;

  if (isMultipart) {
    const { uploadId, parts } = body;
    if (!uploadId || typeof uploadId !== "string" || !Array.isArray(parts) || parts.length === 0) {
      return NextResponse.json({ error: "Champs 'uploadId' et 'parts' requis" }, { status: 400 });
    }
    try {
      await completeMultipartUpload(job.inputKey, uploadId, parts as { partNumber: number }[]);
    } catch (err) {
      console.error(`[transcription/upload-complete] completeMultipartUpload failed key=${job.inputKey}:`, err);
      // Finalisation peut-être déjà faite (requête rejouée après une réponse
      // perdue) : si l'objet existe, l'upload est bien terminé.
      const alreadyComplete = await objectExistsInR2(job.inputKey).catch(() => false);
      if (!alreadyComplete) {
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
    }
  } else {
    let exists: boolean;
    try {
      exists = await objectExistsInR2(job.inputKey);
    } catch (err) {
      console.error(`[transcription/upload-complete] HEAD failed key=${job.inputKey}:`, err);
      return NextResponse.json(
        { error: "Impossible de vérifier le fichier (R2 indisponible). Réessayez." },
        { status: 503 }
      );
    }
    if (!exists) {
      return NextResponse.json(
        { error: "Le fichier n'est pas arrivé sur le stockage" },
        { status: 409 }
      );
    }
  }

  // Gardé par le statut : un DELETE a pu annuler le job pendant la finalisation.
  const uploadedAt = new Date();
  const marked = await prisma.transcriptionJob.updateMany({
    where: { id: job.id, status: "QUEUED" },
    data: { uploadedAt },
  });
  if (marked.count === 0) {
    return NextResponse.json({ error: "Job déjà soumis ou terminé" }, { status: 409 });
  }

  return NextResponse.json({ ok: true, uploadedAt: uploadedAt.toISOString() });
}
