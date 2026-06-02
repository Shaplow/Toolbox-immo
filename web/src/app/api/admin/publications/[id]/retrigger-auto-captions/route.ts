/**
 * POST /api/admin/publications/[id]/retrigger-auto-captions
 *
 * Filet de sécurité admin : rappelle `triggerAutoTranscriptionForRender` sur
 * le Render attaché au slot quand la chaîne auto a silencieusement échoué
 * (cas observé : webhook RunPod renders DONE mais aucun TranscriptionJob créé).
 *
 * Idempotent — l'appelée gère déjà les états COMPLETED/QUEUED/PROCESSING et
 * reset les FAILED. Cet endpoint ne fait que ré-armer le pipeline.
 *
 * ADMIN uniquement. Pas visible côté UI pour les autres rôles.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { triggerAutoTranscriptionForRender } from "@/lib/triggerAutoTranscription";
import { logActivity } from "@/lib/services/slot/activity";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Render n'a pas de colonne outputKey — on le retrouve en strippant le
 * préfixe R2_PUBLIC_URL de `videoUrl`. Cohérent avec la convention
 * `getR2PublicUrl(key) = ${R2_PUBLIC_URL}/${key}`.
 */
function extractR2KeyFromVideoUrl(videoUrl: string): string | null {
  const publicUrl = process.env.R2_PUBLIC_URL?.replace(/\/$/, "");
  if (!publicUrl) return null;
  if (!videoUrl.startsWith(`${publicUrl}/`)) return null;
  return videoUrl.slice(publicUrl.length + 1);
}

export async function POST(_req: NextRequest, { params }: RouteContext) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id: slotId } = await params;

  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: {
      id: true,
      render: {
        select: {
          id: true,
          status: true,
          templateId: true,
          videoUrl: true,
          listing: { select: { userId: true } },
        },
      },
    },
  });
  if (!slot) {
    return NextResponse.json({ error: "Slot introuvable" }, { status: 404 });
  }
  const render = slot.render;
  if (!render) {
    return NextResponse.json(
      { error: "Aucun render rattaché à ce slot — rien à relancer" },
      { status: 400 },
    );
  }
  if (render.status !== "DONE") {
    return NextResponse.json(
      { error: `Le render doit être DONE (actuellement ${render.status}) — attends sa fin avant de relancer la chaîne` },
      { status: 400 },
    );
  }
  if (!render.videoUrl) {
    return NextResponse.json(
      { error: "Render sans videoUrl — la chaîne auto ne peut pas se lancer sans le fichier source" },
      { status: 400 },
    );
  }
  const outputKey = extractR2KeyFromVideoUrl(render.videoUrl);
  if (!outputKey) {
    return NextResponse.json(
      { error: "Impossible d'extraire la clé R2 depuis videoUrl (préfixe R2_PUBLIC_URL ne matche pas)" },
      { status: 400 },
    );
  }

  await logActivity(prisma, {
    slotId,
    actorId: userContext.actualUser.id,
    type: "CAPTIONS_PIPELINE_RETRIGGERED",
    payload: { renderId: render.id },
  });

  // Snapshot état avant — permet de savoir si la fonction a créé/modifié
  // quelque chose (sinon = early return silencieux).
  const beforeJob = await prisma.transcriptionJob.findUnique({
    where: { renderId: render.id },
    select: { id: true, status: true },
  });

  // Diagnostic admin : on AWAIT (au lieu de void) pour pouvoir reporter
  // l'erreur réelle dans la response. Le coût latence (≤ qq secondes pour
  // submit RunPod) est acceptable pour un endpoint admin de debug.
  let triggerError: string | null = null;
  try {
    await triggerAutoTranscriptionForRender(
      render.id,
      render.templateId,
      outputKey,
      render.listing.userId,
    );
  } catch (err) {
    triggerError = err instanceof Error ? err.message : String(err);
    console.error(
      `[retrigger-auto-captions] triggerAutoTranscriptionForRender threw pour slot=${slotId} render=${render.id}:`,
      err,
    );
  }

  // Snapshot état après — diagnostic structuré pour l'admin.
  const afterJob = await prisma.transcriptionJob.findUnique({
    where: { renderId: render.id },
    select: { id: true, status: true, errorMsg: true },
  });

  let diagnostic: string;
  if (triggerError) {
    diagnostic = `Exception : ${triggerError}`;
  } else if (!beforeJob && !afterJob) {
    diagnostic =
      "Aucun TranscriptionJob créé après l'appel — la chaîne a return early silencieusement. Regarde les logs serveur (lignes commençant par [autoTranscription] render=${render.id}).";
  } else if (!beforeJob && afterJob) {
    diagnostic = `TranscriptionJob créé (id=${afterJob.id}, status=${afterJob.status}).${afterJob.errorMsg ? ` Erreur : ${afterJob.errorMsg}` : ""}`;
  } else if (beforeJob && afterJob && beforeJob.status !== afterJob.status) {
    diagnostic = `TranscriptionJob existant ${beforeJob.id} ${beforeJob.status} → ${afterJob.status}.${afterJob.errorMsg ? ` Erreur : ${afterJob.errorMsg}` : ""}`;
  } else if (beforeJob && afterJob) {
    diagnostic = `TranscriptionJob ${afterJob.id} déjà ${afterJob.status} — skip idempotent.`;
  } else {
    diagnostic = "État incohérent (job pre-existant disparu).";
  }

  return NextResponse.json({
    ok: triggerError === null,
    renderId: render.id,
    diagnostic,
    before: beforeJob,
    after: afterJob,
    message: diagnostic,
  });
}
