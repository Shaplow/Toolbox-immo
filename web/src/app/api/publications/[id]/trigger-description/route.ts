/**
 * POST /api/publications/[id]/trigger-description
 *
 * Lance manuellement la chaîne de génération description IA pour un slot.
 *
 * Cas d'usage typique : un slot a needsDescription=autoGenerate mais pas de
 * captions (needsCaptions=false), donc le pipeline render ne déclenche pas
 * de transcription → la description reste bloquée sur "Aucune transcription
 * disponible". Cet endpoint permet de débloquer la chaîne sans avoir à
 * relancer un render complet.
 *
 * Logique :
 *  - Si une transcription COMPLETED existe → triggerAutoDescription direct.
 *  - Si une transcription QUEUED/PROCESSING existe → no-op (déjà en route).
 *  - Sinon → triggerAutoTranscriptionForRender (qui chaînera vers description
 *    via webhook transcription COMPLETED).
 *
 * ADMIN uniquement. Idempotent.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { triggerAutoTranscriptionForRender } from "@/lib/triggerAutoTranscription";
import { triggerAutoDescriptionForTranscription } from "@/lib/triggerAutoDescriptionFromTranscription";
import { transcribeRenderLocal } from "@/lib/transcribeRenderLocal";
import { runpodConfigured } from "@/lib/runpod";
import { r2Configured } from "@/lib/r2";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: RouteContext) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id: slotId } = await params;
  console.info(`[trigger-description] === START slot=${slotId} actor=${userContext.actualUser.id} runpod=${runpodConfigured()} r2=${r2Configured()}`);
  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: {
      id: true,
      render: {
        select: {
          id: true,
          status: true,
          templateId: true,
          // V4 bug #6 : videoUrl utilisé pour détecter les renders image-only
          // (pas de mp4 sur R2 → la transcription échouerait en silence).
          videoUrl: true,
          listing: { select: { userId: true } },
          transcriptionJob: { select: { id: true, status: true } },
        },
      },
      currentVersion: {
        select: {
          transcriptionJob: { select: { id: true, status: true } },
        },
      },
    },
  });
  if (!slot) {
    return NextResponse.json({ error: "Slot introuvable" }, { status: 404 });
  }

  // Préfère la transcription côté render (auto_template), fallback version.
  const existingTranscription =
    slot.render?.transcriptionJob ?? slot.currentVersion?.transcriptionJob ?? null;

  // Cas 1 : transcription déjà COMPLETED → trigger description direct.
  if (existingTranscription?.status === "COMPLETED") {
    void triggerAutoDescriptionForTranscription(existingTranscription.id).catch((err) => {
      console.error(`[trigger-description] triggerAutoDescription failed slot=${slotId}:`, err);
    });
    return NextResponse.json({ ok: true, path: "description_only", transcriptionId: existingTranscription.id });
  }

  // Cas 2 : transcription en cours → no-op (le webhook trigger description).
  if (existingTranscription?.status === "QUEUED" || existingTranscription?.status === "PROCESSING") {
    return NextResponse.json({ ok: true, path: "transcription_in_flight", transcriptionId: existingTranscription.id });
  }

  // Cas 3 : pas de transcription (ou FAILED) — on doit la lancer.
  // Requiert un render DONE pour avoir un input audio.
  const render = slot.render;
  if (!render || render.status !== "DONE") {
    return NextResponse.json(
      { error: "Render non disponible — relancer le render avant la description." },
      { status: 400 },
    );
  }
  if (!render.listing?.userId) {
    return NextResponse.json(
      { error: "Render orphelin (sans listing.userId) — impossible de tracer le job." },
      { status: 400 },
    );
  }
  // V4 bug #6 : un render image-only (template PNG, pas de VideoBlock) n'a
  // pas de mp4 sur R2. Avant on construisait `renders/${id}.mp4` en dur et
  // la transcription échouait silencieusement côté RunPod (audio_url 404).
  // Désormais on rejette tôt avec un message clair.
  if (!render.videoUrl) {
    return NextResponse.json(
      {
        error:
          "Ce render est image-only (PNG). La transcription nécessite une vidéo — utilisez un template avec un VideoBlock pour activer la description IA.",
      },
      { status: 400 },
    );
  }
  // Choix prod vs dev :
  //  - RunPod + R2 configurés → triggerAutoTranscriptionForRender (asynchrone)
  //  - Sinon → transcribeRenderLocal (synchrone via CAPTIONS_API_URL)
  if (runpodConfigured() && r2Configured()) {
    const renderOutputKey = `renders/${render.id}.mp4`;
    void triggerAutoTranscriptionForRender(
      render.id,
      render.templateId,
      renderOutputKey,
      render.listing.userId,
    ).catch((err) => {
      console.error(`[trigger-description] triggerAutoTranscription failed slot=${slotId}:`, err);
    });
    return NextResponse.json({ ok: true, path: "transcription_started", mode: "runpod", renderId: render.id });
  }

  void transcribeRenderLocal(render.id).catch((err) => {
    console.error(`[trigger-description] transcribeRenderLocal failed slot=${slotId}:`, err);
  });
  return NextResponse.json({ ok: true, path: "transcription_started", mode: "local", renderId: render.id });
}
