/**
 * heartbeat — signe de vie d'un upload multipart en cours.
 *
 * ## Le problème résolu
 *
 * Un job de transcription (ou de captions) est créé en `QUEUED` **avant** que
 * l'upload commence : le prepare crée la ligne, puis le navigateur pousse les
 * parties directement vers R2 sans plus jamais toucher la DB jusqu'à
 * `/upload-complete`.
 *
 * Or le sweep admin (`/api/admin/jobs/sweep`) passe en FAILED tout job `QUEUED`
 * dont `updatedAt` dépasse 10 minutes, en partant du principe qu'un job qui ne
 * bouge plus est un upload abandonné. Sur un rush de 100 Go — plusieurs heures
 * d'upload — cette hypothèse est fausse : le job est bien vivant, c'est juste que
 * rien n'écrit en DB pendant le transfert.
 *
 * Conséquence sans ce module : un admin qui déclenche un sweep pendant un upload
 * long tue le job, `/upload-complete` renvoie ensuite 409, et les parties déjà
 * poussées sur R2 deviennent orphelines (et facturées).
 *
 * ## La solution
 *
 * Le client appelle cette route périodiquement pendant l'upload. Elle ne fait
 * qu'une chose : toucher `updatedAt`. Le sweep garde donc son seuil de 10 minutes
 * — c'était l'absence de signe de vie qui était le bug, pas la valeur du seuil.
 *
 * Volontairement idempotent et sans effet de bord : si le job n'est plus `QUEUED`
 * (déjà soumis, terminé, ou tué), on répond 200 avec `touched: false` au lieu
 * d'une erreur. Un heartbeat qui échoue ne doit jamais faire échouer un upload.
 */

import { NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

/** Familles de jobs dont l'upload précède la soumission. */
export type UploadJobKind = "transcription" | "caption";

/**
 * Traite un heartbeat d'upload pour un job donné.
 *
 * Mêmes gardes que `/upload-complete` : auth obligatoire, et ownership
 * `job.userId === effectiveUser.id` (ou bypass admin). Un utilisateur ne peut
 * donc pas maintenir en vie le job d'un autre.
 */
export async function handleUploadHeartbeat(
  kind: UploadJobKind,
  jobId: string,
): Promise<NextResponse> {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const select = { id: true, userId: true, status: true } as const;
  const job =
    kind === "transcription"
      ? await prisma.transcriptionJob.findUnique({ where: { id: jobId }, select })
      : await prisma.captionJob.findUnique({ where: { id: jobId }, select });

  if (!job) {
    return NextResponse.json({ error: "Job introuvable" }, { status: 404 });
  }
  if (job.userId !== userContext.effectiveUser.id && !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  // Pas d'erreur si le job a changé d'état entre-temps : le heartbeat est un
  // signal best-effort, il ne doit jamais casser le flux d'upload du client.
  if (job.status !== "QUEUED") {
    return NextResponse.json({ ok: true, touched: false, status: job.status });
  }

  // `updatedAt` est déclaré `@updatedAt` : l'écrire explicitement garantit que la
  // colonne bouge même si aucun autre champ ne change.
  const data = { updatedAt: new Date() };
  if (kind === "transcription") {
    await prisma.transcriptionJob.update({ where: { id: jobId }, data });
  } else {
    await prisma.captionJob.update({ where: { id: jobId }, data });
  }

  return NextResponse.json({ ok: true, touched: true });
}
