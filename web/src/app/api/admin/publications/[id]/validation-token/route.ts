/**
 * POST   /api/admin/publications/[id]/validation-token — génère un nouveau magic link
 * GET    /api/admin/publications/[id]/validation-token — info sur le token actif (sans rawToken)
 * DELETE /api/admin/publications/[id]/validation-token — révoque tous les tokens actifs
 *
 * ADMIN uniquement. Le rawToken n'est retourné qu'à la création (POST).
 * Après ça, on ne peut plus le lire — l'admin doit le copier ou en regénérer un.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import {
  generateClientValidationToken,
  revokeClientValidationTokens,
  CLIENT_VALIDATION_TOKEN_TTL_MS,
} from "@/lib/publications/clientValidation";
import { resolveClientValidationConfig } from "@/lib/services/slot/config";
import { resolveCaptionsMode, isCaptionsAuto } from "@/lib/publications/captionsMode";
import { logActivity } from "@/lib/services/slot/activity";
import { resolveActiveCaptionJob } from "@/lib/publications/jobLifecycle";
import { slotEffectivePatternSelect, resolveSlotEffectivePattern } from "@/lib/services/slot/effectivePattern";

type RouteContext = { params: Promise<{ id: string }> };

// ─── POST — génère un nouveau token (révoque les anciens) ─────────────────────

export async function POST(_req: NextRequest, { params }: RouteContext) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id: slotId } = await params;

  // Le slot doit exister et avoir validation client activée (pattern OU override)
  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: {
      id: true,
      status: true,
      needsClientValidationOverride: true,
      allowsClientRevisionOverride: true,
      needsCaptionsModeOverride: true,
      needsCaptionsOverride: true,
      activeCaptionJob: {
        select: { id: true, status: true, staleSince: true },
      },
      captionJobs: {
        select: { id: true, status: true, staleSince: true },
        orderBy: { createdAt: "desc" },
      },
      ...slotEffectivePatternSelect,
    },
  });
  if (!slot) {
    return NextResponse.json({ error: "Slot introuvable" }, { status: 404 });
  }

  const effPattern = resolveSlotEffectivePattern(slot);
  const config = resolveClientValidationConfig(
    {
      needsClientValidationOverride: slot.needsClientValidationOverride,
      allowsClientRevisionOverride: slot.allowsClientRevisionOverride,
    },
    effPattern,
  );
  if (!config.needsClientValidation) {
    return NextResponse.json(
      { error: "La validation client n'est pas activée pour ce slot (pattern + override)" },
      { status: 400 },
    );
  }

  // Le slot doit être dans un statut compatible avec un envoi pour validation.
  // - READY_FOR_CM      : premier envoi (flux auto_template : le pipeline y mène).
  // - EDIT_APPROVED     : flux à montage humain (manual_rushes / external_upload) —
  //   la promotion de version pose EDIT_APPROVED et aucune transition auto ne le
  //   fait avancer (computeAutoTransitionTargetPure est auto_template-only). Sans
  //   ce statut, le CM/ADMIN restait bloqué alors que le montage était validé.
  // - CAPTIONS_PENDING  : post-montage, sous-titres en attente — cohérence.
  // - CLIENT_REVISION   : renvoi après corrections.
  // - AWAITING_CLIENT   : régénération du lien.
  // La garde captions ci-dessous protège l'invariant « le client voit la vidéo
  // finale sous-titrée » quel que soit le statut d'entrée. La route bascule
  // ensuite le slot en AWAITING_CLIENT (update direct, cf. plus bas).
  const ALLOWED_STATUSES = [
    "READY_FOR_CM",
    "EDIT_APPROVED",
    "CAPTIONS_PENDING",
    "CLIENT_REVISION",
    "AWAITING_CLIENT",
  ];
  if (!ALLOWED_STATUSES.includes(slot.status)) {
    return NextResponse.json(
      {
        error: `Le slot doit avoir un montage validé avant l'envoi en validation client (statut actuel : ${slot.status})`,
      },
      { status: 400 },
    );
  }

  // V8.10 — Verrou backend : captions auto doivent être COMPLETED + non-stale.
  // Le client doit voir la vidéo finale avec sous-titres, pas la brute.
  // Évite bypass via API directe quand UI lock (canSendValidation) est désactivé.
  // Mode "manual" exclu : pas de CaptionJob généré (édition libre via CaptionEditor),
  // pas de garde possible. Mode "none" : aucun captions requis.
  const captionsMode = resolveCaptionsMode({
    slot: {
      needsCaptionsModeOverride: slot.needsCaptionsModeOverride,
      needsCaptionsOverride: slot.needsCaptionsOverride,
    },
    pattern: effPattern,
  });
  if (isCaptionsAuto(captionsMode)) {
    // Aligné sur l'UI (PublicationFiche.canSendValidation) : résolution via
    // resolveActiveCaptionJob qui fallback sur captionJobs[] si le pointeur
    // activeCaptionJob est null. Avant ce fix, le pipeline auto ne promouvait
    // pas activeCaptionJobId → UI affichait "Sous-titres générés" mais l'API
    // rejetait l'envoi avec "Aucun job actif". Désormais onCaptionsCompleted
    // auto-promeut, mais on garde le fallback ici pour réparer les slots déjà
    // dans cet état (pas de migration data).
    const activeCaption = resolveActiveCaptionJob({
      activeCaptionJob: slot.activeCaptionJob,
      captionJobs: slot.captionJobs,
    });
    if (!activeCaption) {
      return NextResponse.json(
        {
          error:
            "Aucun job de sous-titres actif sur ce slot. Lance les captions avant d'envoyer pour validation.",
        },
        { status: 400 },
      );
    }
    if (activeCaption.status !== "COMPLETED" || activeCaption.staleSince) {
      return NextResponse.json(
        {
          error:
            "Les sous-titres doivent être terminés avant l'envoi pour validation (le client doit voir la vidéo finale).",
        },
        { status: 400 },
      );
    }
    // Auto-rattrapage : si le job a été résolu via fallback (pas via le
    // pointeur), on promeut maintenant pour rendre la DB cohérente pour les
    // consommateurs ultérieurs.
    if (!slot.activeCaptionJob) {
      await prisma.publicationSlot.update({
        where: { id: slotId },
        data: { activeCaptionJobId: activeCaption.id },
      });
    }
  }

  // ADMIN qui crée le token = actualUser (pas effectiveUser, pour audit fidèle)
  const createdByUserId = userContext.actualUser.id;

  const { rawToken, tokenId, expiresAt } = await generateClientValidationToken(prisma, {
    slotId,
    createdByUserId,
  });

  // Auto-bascule vers AWAITING_CLIENT (si pas déjà). Idempotent.
  if (slot.status !== "AWAITING_CLIENT") {
    await prisma.publicationSlot.update({
      where: { id: slotId },
      data: { status: "AWAITING_CLIENT" },
    });
    await logActivity(prisma, {
      slotId,
      actorId: createdByUserId,
      type: "STATUS_CHANGED",
      payload: { from: slot.status, to: "AWAITING_CLIENT", trigger: "CLIENT_VALIDATION_SENT" },
    });
  }

  await logActivity(prisma, {
    slotId,
    actorId: createdByUserId,
    type: "CLIENT_VALIDATION_TOKEN_GENERATED",
    payload: { tokenId, expiresAt: expiresAt.toISOString() },
  });

  return NextResponse.json({
    tokenId,
    rawToken, // jamais re-renvoyé après cette réponse
    expiresAt: expiresAt.toISOString(),
    ttlSec: Math.floor(CLIENT_VALIDATION_TOKEN_TTL_MS / 1000),
  });
}

// ─── GET — info token actif (sans rawToken) ──────────────────────────────────

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id: slotId } = await params;
  const active = await prisma.clientValidationToken.findFirst({
    where: { slotId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      expiresAt: true,
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });

  return NextResponse.json({ activeToken: active });
}

// ─── DELETE — révoque tous les tokens actifs ─────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id: slotId } = await params;
  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: { id: true, status: true },
  });
  if (!slot) return NextResponse.json({ error: "Slot introuvable" }, { status: 404 });

  const revoked = await revokeClientValidationTokens(prisma, slotId);

  // Si le slot était AWAITING_CLIENT, on retourne en READY_FOR_CM (annulation
  // de la demande de validation). Pas de retour automatique si déjà avancé.
  if (slot.status === "AWAITING_CLIENT") {
    await prisma.publicationSlot.update({
      where: { id: slotId },
      data: { status: "READY_FOR_CM" },
    });
    await logActivity(prisma, {
      slotId,
      actorId: userContext.actualUser.id,
      type: "STATUS_CHANGED",
      payload: { from: "AWAITING_CLIENT", to: "READY_FOR_CM", trigger: "CLIENT_VALIDATION_TOKEN_REVOKED" },
    });
  }

  return NextResponse.json({ revoked });
}
