/**
 * POST /api/admin/publications/[id]/retrigger-auto-captions
 *
 * Filet de sécurité admin quand la chaîne auto a silencieusement échoué.
 * Détecte où la chaîne s'est cassée et relance la phase manquante :
 *   - Pas de TranscriptionJob → triggerAutoTranscriptionForRender (full chain)
 *   - TranscriptionJob COMPLETED mais pas de CaptionJob → triggerAutoCaptionForTranscription
 *   - TranscriptionJob FAILED → triggerAutoTranscriptionForRender (reset + resubmit)
 *   - TranscriptionJob QUEUED/PROCESSING → no-op (laisser tourner)
 *
 * Idempotent. Diagnostic structuré retourné dans la response pour debug.
 *
 * ADMIN uniquement.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { triggerAutoTranscriptionForRender } from "@/lib/triggerAutoTranscription";
import { triggerAutoCaptionForTranscription } from "@/lib/triggerAutoCaptionFromTranscription";
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

  // Snapshot état avant : où est cassée la chaîne ?
  const transcriptionBefore = await prisma.transcriptionJob.findUnique({
    where: { renderId: render.id },
    select: { id: true, status: true },
  });
  const captionBefore = await prisma.captionJob.findFirst({
    where: { slotId, staleSince: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true },
  });

  // Décision : quelle phase relancer ?
  let phaseTriggered: "transcription" | "caption" | "none";
  let triggerError: string | null = null;

  if (
    transcriptionBefore &&
    transcriptionBefore.status === "COMPLETED" &&
    (!captionBefore ||
      captionBefore.status === "FAILED")
  ) {
    // Cas observé : transcription OK mais caption jamais créé (chaîne cassée
    // entre webhook transcription COMPLETED et triggerAutoCaptionForTranscription).
    phaseTriggered = "caption";
    try {
      await triggerAutoCaptionForTranscription(transcriptionBefore.id);
    } catch (err) {
      triggerError = err instanceof Error ? err.message : String(err);
      console.error(
        `[retrigger-auto-captions] triggerAutoCaptionForTranscription threw pour slot=${slotId} transcription=${transcriptionBefore.id}:`,
        err,
      );
    }
  } else if (
    transcriptionBefore &&
    (transcriptionBefore.status === "QUEUED" || transcriptionBefore.status === "PROCESSING")
  ) {
    phaseTriggered = "none";
  } else {
    // Pas de transcription OU transcription FAILED : on (re)lance depuis le début.
    phaseTriggered = "transcription";
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
  }

  // Snapshot état après
  const transcriptionAfter = await prisma.transcriptionJob.findUnique({
    where: { renderId: render.id },
    select: { id: true, status: true, errorMsg: true },
  });
  const captionAfter = await prisma.captionJob.findFirst({
    where: { slotId, staleSince: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, errorMsg: true },
  });

  let diagnostic: string;
  if (triggerError) {
    diagnostic = `Exception (${phaseTriggered}) : ${triggerError}`;
  } else if (phaseTriggered === "none") {
    diagnostic = `Transcription ${transcriptionBefore?.id} déjà ${transcriptionBefore?.status} — laissée tourner (aucune action).`;
  } else if (phaseTriggered === "transcription") {
    if (!transcriptionAfter) {
      diagnostic = `Phase transcription relancée — aucun TranscriptionJob créé après l'appel (early return silencieux dans triggerAutoTranscriptionForRender). Vérifie les logs serveur [autoTranscription] render=${render.id}.`;
    } else {
      diagnostic = `Phase transcription : ${transcriptionBefore?.status ?? "absent"} → ${transcriptionAfter.status} (id=${transcriptionAfter.id})${transcriptionAfter.errorMsg ? `. Erreur : ${transcriptionAfter.errorMsg}` : ""}.`;
    }
  } else {
    // phase caption
    if (!captionAfter || captionAfter.id === captionBefore?.id) {
      diagnostic = `Phase caption relancée — aucun nouveau CaptionJob créé (early return silencieux dans triggerAutoCaptionForTranscription). Vérifie les logs serveur [autoCaption] transcriptionJob=${transcriptionBefore?.id}.`;
    } else {
      diagnostic = `Phase caption : ${captionBefore?.status ?? "absent"} → ${captionAfter.status} (id=${captionAfter.id})${captionAfter.errorMsg ? `. Erreur : ${captionAfter.errorMsg}` : ""}.`;
    }
  }

  return NextResponse.json({
    ok: triggerError === null,
    renderId: render.id,
    phaseTriggered,
    diagnostic,
    before: { transcription: transcriptionBefore, caption: captionBefore },
    after: { transcription: transcriptionAfter, caption: captionAfter },
    message: diagnostic,
  });
}
