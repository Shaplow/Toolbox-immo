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
import {
  triggerAutoCaptionForTranscription,
  resolveZone,
  resolveSlotExcludeZones,
  applyExcludeZones,
} from "@/lib/triggerAutoCaptionFromTranscription";
import { logActivity } from "@/lib/services/slot/activity";
import { r2Configured, getFromR2 } from "@/lib/r2";
import { runpodConfigured } from "@/lib/runpod";
import type { TemplateJSON, AnyBlock } from "@/types/template";

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

export async function POST(req: NextRequest, { params }: RouteContext) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  // ?force=true : invalide la transcription existante et marque les
  // CaptionJobs comme stale, pour forcer un re-Whisper from scratch.
  // Cas d'usage : on a modifié les params VAD côté worker (silero threshold,
  // min_silence_duration) et on veut re-transcrire un job dont le résultat
  // a été pollué par les anciens params.
  const force = new URL(req.url).searchParams.get("force") === "true";

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
    payload: { renderId: render.id, force },
  });

  // ── Mode force : invalide la transcription + caption job existants ───────
  // On ne supprime PAS (l'historique reste). On marque FAILED côté
  // transcription (pour que triggerAutoTranscriptionForRender la reset à
  // QUEUED + resubmit) et staleSince côté caption (pour ne plus apparaître
  // comme job actif). Reset des pointeurs activeX à null en passant.
  if (force) {
    const now = new Date();
    await prisma.$transaction([
      prisma.transcriptionJob.updateMany({
        where: { renderId: render.id, status: { not: "FAILED" } },
        data: { status: "FAILED", errorMsg: "Invalidée par admin (force re-transcribe)" },
      }),
      prisma.captionJob.updateMany({
        where: { slotId, staleSince: null },
        data: { staleSince: now, staleReason: "pattern_changed" },
      }),
      prisma.publicationSlot.update({
        where: { id: slotId },
        data: { activeCaptionJobId: null, activeTranscriptionJobId: null },
      }),
    ]);
  }

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

  // Pre-flight check pour la phase caption : on inspecte EXACTEMENT chaque
  // condition de skip de triggerAutoCaptionForTranscription pour reporter
  // au front sans avoir à lire les logs serveur.
  let preflightSkipReason: string | null = null;

  if (
    transcriptionBefore &&
    transcriptionBefore.status === "COMPLETED" &&
    (!captionBefore || captionBefore.status === "FAILED")
  ) {
    // Inspection précise des conditions de skip de triggerAutoCaptionForTranscription.
    const fullTranscription = await prisma.transcriptionJob.findUnique({
      where: { id: transcriptionBefore.id },
      select: { id: true, renderId: true, outputJsonKey: true, inputKey: true },
    });
    if (!r2Configured()) {
      preflightSkipReason = "R2 non configuré côté serveur (R2_PUBLIC_URL/etc manquants)";
    } else if (!runpodConfigured() || !process.env.RUNPOD_API_KEY || !process.env.RUNPOD_ENDPOINT_ID) {
      preflightSkipReason = "RunPod non configuré (RUNPOD_API_KEY / RUNPOD_ENDPOINT_ID manquants)";
    } else if (!fullTranscription?.renderId) {
      preflightSkipReason = `TranscriptionJob ${transcriptionBefore.id} n'a pas de renderId (lien rompu)`;
    } else if (!fullTranscription.outputJsonKey) {
      preflightSkipReason = `TranscriptionJob ${transcriptionBefore.id} sans outputJsonKey (segments non sauvegardés en R2)`;
    } else if (!fullTranscription.inputKey) {
      preflightSkipReason = `TranscriptionJob ${transcriptionBefore.id} sans inputKey (la vidéo source R2 a été nettoyée — le webhook transcription a effacé inputKey alors qu'il devait le conserver pour un job auto-pipeline)`;
    } else {
      const renderFull = await prisma.render.findUnique({
        where: { id: fullTranscription.renderId },
        select: { id: true, templateId: true },
      });
      if (!renderFull?.templateId) {
        preflightSkipReason = `Render ${fullTranscription.renderId} introuvable ou sans templateId`;
      } else {
        const tpl = await prisma.template.findUnique({
          where: { id: renderFull.templateId },
          select: { id: true, jsonData: true },
        });
        if (!tpl) {
          preflightSkipReason = `Template ${renderFull.templateId} introuvable en base`;
        } else {
          let tplJson: TemplateJSON | null = null;
          try {
            tplJson = JSON.parse(tpl.jsonData) as TemplateJSON;
          } catch {
            preflightSkipReason = `Template ${tpl.id} jsonData invalide (parse JSON failed)`;
          }
          if (tplJson) {
            const cfg = tplJson.captionAutoConfig;
            if (!cfg?.enabled) {
              preflightSkipReason = `Template ${tpl.id} : captionAutoConfig.enabled=false → captions auto désactivées sur ce template`;
            } else if (!cfg.presetId) {
              preflightSkipReason = `Template ${tpl.id} : captionAutoConfig.presetId manquant — aucun preset captions configuré`;
            } else {
              const preset = await prisma.captionPreset.findUnique({
                where: { id: cfg.presetId },
                select: { id: true },
              });
              if (!preset) {
                preflightSkipReason = `Template ${tpl.id} référence un preset captions ${cfg.presetId} qui n'existe pas en base`;
              } else {
                // Pre-flight étendu : lecture R2 des segments + filtrage zones.
                // Si on arrive ici, toutes les conditions de skip "config"
                // passent. Reste 2 raisons silencieuses possibles :
                //  - getFromR2(outputJsonKey) throw (R2 erreur réseau / 404)
                //  - filteredSegments.length === 0 après zones d'exclusion
                try {
                  const buf = await getFromR2(fullTranscription.outputJsonKey);
                  const rawSegments = JSON.parse(buf.toString("utf-8")) as Array<{
                    start: number;
                    end: number;
                    text: string;
                  }>;
                  const blocks: AnyBlock[] = tplJson.blocks ?? [];
                  const resolvedZones = (cfg.excludeZones ?? [])
                    .map((zone) => resolveZone(zone, blocks))
                    .filter((z): z is NonNullable<typeof z> => z !== null);

                  // Charger render pour slotDurations / job.duration via la transcription complète
                  const renderForZones = await prisma.render.findUnique({
                    where: { id: fullTranscription.renderId },
                    select: { slotDurations: true },
                  });
                  let slotDurations: Record<string, number> | undefined;
                  if (renderForZones?.slotDurations) {
                    try {
                      slotDurations = JSON.parse(renderForZones.slotDurations) as Record<
                        string,
                        number
                      >;
                    } catch {
                      // ignore
                    }
                  }
                  const txDuration = await prisma.transcriptionJob.findUnique({
                    where: { id: fullTranscription.id },
                    select: { duration: true },
                  });

                  const slotZones =
                    cfg.excludeSlotIds?.length && tplJson.videoSequence?.length
                      ? resolveSlotExcludeZones(
                          cfg.excludeSlotIds,
                          tplJson.videoSequence,
                          txDuration?.duration ?? null,
                          slotDurations,
                        )
                      : [];

                  const filtered = applyExcludeZones(
                    rawSegments,
                    [...resolvedZones, ...slotZones],
                    txDuration?.duration ?? null,
                  );

                  if (filtered.length === 0) {
                    preflightSkipReason = `Aucun segment de transcription après filtrage des zones d'exclusion (${rawSegments.length} segments bruts, ${resolvedZones.length + slotZones.length} zones d'exclusion) — la vidéo est entièrement couverte par des zones excluant les sous-titres`;
                  }
                } catch (r2Err) {
                  preflightSkipReason = `Lecture R2 des segments échouée (key=${fullTranscription.outputJsonKey}) : ${String(r2Err)}`;
                }
              }
            }
          }
        }
      }
    }

    phaseTriggered = "caption";
    if (!preflightSkipReason) {
      try {
        await triggerAutoCaptionForTranscription(transcriptionBefore.id);
      } catch (err) {
        triggerError = err instanceof Error ? err.message : String(err);
        console.error(
          `[retrigger-auto-captions] triggerAutoCaptionForTranscription threw pour slot=${slotId} transcription=${transcriptionBefore.id}:`,
          err,
        );
      }
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
  if (preflightSkipReason) {
    diagnostic = `Cause identifiée du skip caption : ${preflightSkipReason}`;
  } else if (triggerError) {
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
