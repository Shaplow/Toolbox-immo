/**
 * POST /api/admin/jobs/sweep
 *
 * Balaie tous les jobs en PROCESSING / QUEUED depuis trop longtemps et les
 * passe en FAILED avec un message d'erreur explicite.
 *
 * Utile pour récupérer des jobs bloqués après une coupure RunPod, un redémarrage
 * du serveur sans webhook, ou un upload client qui n'a jamais appelé /submit.
 *
 * Seuils par défaut :
 *   PROCESSING  > 2 h  → RunPod webhook jamais reçu (coupure, NEXTAUTH_URL absent…)
 *   QUEUED      > 30 min → upload client jamais finalisé (/submit jamais appelé)
 *
 * Retourne le décompte de jobs marqués FAILED par type.
 *
 * Accès : ADMIN uniquement.
 */

import { NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

// Fix bug 2026-05-30 : seuils réduits — l'UI alerte déjà dès 30min, et les
// jobs PROCESSING > 30min sont en pratique morts (Next hot-reload, render-engine
// down, webhook RunPod jamais reçu). Garder 2h c'était trop permissif et
// laissait s'accumuler des zombies.
const PROCESSING_STALL_MS  = 30 * 60 * 1000;       // 30 min (était 2h)
const QUEUED_STALL_MS      = 10 * 60 * 1000;       // 10 min (était 30min)
// Seuil pour qu'un job orphelin (slotId=null) soit considéré "vieux".
// 30 jours après la cassure du lien slot, le job est très probablement
// inutilisé — flaggué dans le summary pour monitoring (pas supprimé
// automatiquement : on garde l'audit). Le cleanup réel passe par script
// dédié si besoin.
const ORPHAN_AGE_MS        = 30 * 24 * 60 * 60 * 1000; // 30 jours

export async function POST() {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const now = new Date();
  const processingCutoff = new Date(now.getTime() - PROCESSING_STALL_MS);
  const queuedCutoff     = new Date(now.getTime() - QUEUED_STALL_MS);

  // ── CaptionJob ────────────────────────────────────────────────────────────
  const [captionProcessing, captionQueued] = await Promise.all([
    prisma.captionJob.updateMany({
      where: { status: "PROCESSING", updatedAt: { lt: processingCutoff } },
      data:  { status: "FAILED", errorMsg: "Job bloqué en PROCESSING — webhook RunPod jamais reçu (sweep automatique)" },
    }),
    prisma.captionJob.updateMany({
      where: { status: "QUEUED", updatedAt: { lt: queuedCutoff } },
      data:  { status: "FAILED", errorMsg: "Job bloqué en QUEUED — upload ou submit jamais finalisé (sweep automatique)" },
    }),
  ]);

  // ── TranscriptionJob ──────────────────────────────────────────────────────
  const [transcriptionProcessing, transcriptionQueued] = await Promise.all([
    prisma.transcriptionJob.updateMany({
      where: { status: "PROCESSING", updatedAt: { lt: processingCutoff } },
      data:  { status: "FAILED", errorMsg: "Job bloqué en PROCESSING — webhook RunPod jamais reçu (sweep automatique)" },
    }),
    prisma.transcriptionJob.updateMany({
      where: { status: "QUEUED", updatedAt: { lt: queuedCutoff } },
      data:  { status: "FAILED", errorMsg: "Job bloqué en QUEUED — upload ou submit jamais finalisé (sweep automatique)" },
    }),
  ]);

  // ── Render ────────────────────────────────────────────────────────────────
  // Un render qui reste en PROCESSING ou PENDING après le seuil signifie
  // que le webhook RunPod n'est jamais arrivé (NEXTAUTH_URL mal configuré,
  // coupure transitoire, redémarrage serveur mid-job). Sans sweep, le
  // slot reste bloqué en IN_PROGRESS indéfiniment et l'admin doit
  // force-fail à la main. Mêmes seuils que captions/transcription pour
  // cohérence opérationnelle. RenderStatus n'a que PENDING/PROCESSING/
  // DONE/ERROR — pas de QUEUED distinct.
  // Render n'a pas de updatedAt — on utilise createdAt (la date ne change
  // jamais, donc un render créé il y a 2h dans PROCESSING est stale par
  // définition).
  const [renderProcessing, renderPending] = await Promise.all([
    prisma.render.updateMany({
      where: { status: "PROCESSING", createdAt: { lt: processingCutoff } },
      data:  { status: "ERROR", errorMsg: "Render bloqué en PROCESSING — webhook RunPod jamais reçu (sweep automatique)" },
    }),
    prisma.render.updateMany({
      where: { status: "PENDING", createdAt: { lt: queuedCutoff } },
      data:  { status: "ERROR", errorMsg: "Render bloqué en PENDING — soumission RunPod jamais finalisée (sweep automatique)" },
    }),
  ]);

  // ── MediaEditJob ──────────────────────────────────────────────────────────
  // Jobs d'édition asset (trim, normalize, gain) qui restent "processing" sans
  // webhook arrivé. Statuts lowercase pour ce modèle ("pending"/"processing"/
  // "done"/"failed") — divergence historique avec Render/Caption.
  const [mediaEditProcessing, mediaEditPending] = await Promise.all([
    prisma.mediaEditJob.updateMany({
      where: { status: "processing", updatedAt: { lt: processingCutoff } },
      data:  { status: "failed", errorMsg: "Job bloqué en processing — webhook RunPod jamais reçu (sweep automatique)" },
    }),
    prisma.mediaEditJob.updateMany({
      where: { status: "pending", updatedAt: { lt: queuedCutoff } },
      data:  { status: "failed", errorMsg: "Job bloqué en pending — soumission RunPod jamais finalisée (sweep automatique)" },
    }),
  ]);

  // ── CoverFramePack ────────────────────────────────────────────────────────
  // Fix bug 2026-05-30 : packs cover absents du sweep auparavant → si le
  // render-engine local crash pendant extractFrames ou si triggerAutoCover
  // est appelé alors que le render est mort, le pack reste PROCESSING/QUEUED
  // indéfiniment. Mêmes seuils que les autres jobs pour cohérence.
  const [coverProcessing, coverQueued] = await Promise.all([
    prisma.coverFramePack.updateMany({
      where: { status: "PROCESSING", updatedAt: { lt: processingCutoff } },
      data:  { status: "FAILED", errorMsg: "Cover pack bloqué en PROCESSING — extraction frames jamais finalisée (sweep automatique)" },
    }),
    prisma.coverFramePack.updateMany({
      where: { status: "QUEUED", updatedAt: { lt: queuedCutoff } },
      data:  { status: "FAILED", errorMsg: "Cover pack bloqué en QUEUED — préparation jamais déclenchée (sweep automatique)" },
    }),
  ]);

  // ── MediaAutocutBatch ─────────────────────────────────────────────────────
  // Batch d'analyse Whisper de plusieurs assets. Si le batch reste processing
  // au-delà du seuil, on le passe failed. Pas de revert sur les jobs internes
  // (les MediaAutocutJob non terminés du batch sont laissés tels quels — on
  // peut les retraiter via un re-run du batch).
  const [autocutBatchProcessing, autocutBatchPending] = await Promise.all([
    prisma.mediaAutocutBatch.updateMany({
      where: { status: "processing", updatedAt: { lt: processingCutoff } },
      data:  { status: "failed", errorMsg: "Batch bloqué en processing — webhook RunPod jamais reçu (sweep automatique)" },
    }),
    prisma.mediaAutocutBatch.updateMany({
      where: { status: "pending", updatedAt: { lt: queuedCutoff } },
      data:  { status: "failed", errorMsg: "Batch bloqué en pending — soumission RunPod jamais finalisée (sweep automatique)" },
    }),
  ]);

  // ── Orphelins (slotId=null, status terminal, ancienneté > 30j) ────────────
  // Reporting seul — pas de suppression auto (audit trail préservé). Si le
  // chiffre grossit anormalement, lancer un script de cleanup R2/DB
  // dédié. Ces orphelins viennent typiquement de slots supprimés via
  // /api/calendar/slots/[id] (DELETE pose SetNull sur Render.publication
  // SlotId et CaptionJob.slotId).
  const orphanCutoff = new Date(now.getTime() - ORPHAN_AGE_MS);
  const [orphanCaptions, orphanRenders] = await Promise.all([
    prisma.captionJob.count({
      where: {
        slotId: null,
        status: { in: ["COMPLETED", "FAILED"] },
        updatedAt: { lt: orphanCutoff },
      },
    }),
    prisma.render.count({
      where: {
        publicationSlotId: null,
        status: { in: ["DONE", "ERROR"] },
        createdAt: { lt: orphanCutoff },
      },
    }),
  ]);

  const summary = {
    captions: {
      processing: captionProcessing.count,
      queued:     captionQueued.count,
    },
    transcription: {
      processing: transcriptionProcessing.count,
      queued:     transcriptionQueued.count,
    },
    renders: {
      processing: renderProcessing.count,
      pending:    renderPending.count,
    },
    mediaEdit: {
      processing: mediaEditProcessing.count,
      pending:    mediaEditPending.count,
    },
    coverPacks: {
      processing: coverProcessing.count,
      queued:     coverQueued.count,
    },
    autocutBatch: {
      processing: autocutBatchProcessing.count,
      pending:    autocutBatchPending.count,
    },
    /** Compteurs informatifs — ces jobs ne sont pas modifiés par le sweep,
     *  juste reportés pour monitoring de la dette. */
    orphans: {
      captions:  orphanCaptions,
      renders:   orphanRenders,
      olderThan: `${Math.round(ORPHAN_AGE_MS / (24 * 60 * 60 * 1000))}j`,
    },
    total:
      captionProcessing.count + captionQueued.count +
      transcriptionProcessing.count + transcriptionQueued.count +
      renderProcessing.count + renderPending.count +
      mediaEditProcessing.count + mediaEditPending.count +
      autocutBatchProcessing.count + autocutBatchPending.count +
      coverProcessing.count + coverQueued.count,
  };

  console.info("[admin/jobs/sweep] Sweep terminé par", userContext.actualUser.id, "—", JSON.stringify(summary));

  return NextResponse.json({ ok: true, swept: summary });
}
