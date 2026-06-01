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
      activeCaptionJobId: true,
      pattern: {
        select: {
          needsClientValidation: true,
          allowsClientRevision: true,
          needsCaptionsMode: true,
          needsCaptions: true,
        },
      },
    },
  });
  if (!slot) {
    return NextResponse.json({ error: "Slot introuvable" }, { status: 404 });
  }

  const config = resolveClientValidationConfig(
    {
      needsClientValidationOverride: slot.needsClientValidationOverride,
      allowsClientRevisionOverride: slot.allowsClientRevisionOverride,
    },
    slot.pattern,
  );
  if (!config.needsClientValidation) {
    return NextResponse.json(
      { error: "La validation client n'est pas activée pour ce slot (pattern + override)" },
      { status: 400 },
    );
  }

  // Le slot doit être dans un statut compatible avec un envoi pour validation.
  // Cas usuel : READY_FOR_CM (premier envoi) ou CLIENT_REVISION (renvoi après corrections).
  // ADMIN peut aussi envoyer depuis AWAITING_CLIENT (régénération du lien).
  const ALLOWED_STATUSES = ["READY_FOR_CM", "CLIENT_REVISION", "AWAITING_CLIENT"];
  if (!ALLOWED_STATUSES.includes(slot.status)) {
    return NextResponse.json(
      {
        error: `Le slot doit être en READY_FOR_CM, CLIENT_REVISION ou AWAITING_CLIENT (actuellement ${slot.status})`,
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
    pattern: slot.pattern,
  });
  if (isCaptionsAuto(captionsMode)) {
    if (!slot.activeCaptionJobId) {
      return NextResponse.json(
        {
          error:
            "Aucun job de sous-titres actif sur ce slot. Lance les captions avant d'envoyer pour validation.",
        },
        { status: 400 },
      );
    }
    const activeCaption = await prisma.captionJob.findUnique({
      where: { id: slot.activeCaptionJobId },
      select: { status: true, staleSince: true },
    });
    if (!activeCaption || activeCaption.status !== "COMPLETED" || activeCaption.staleSince) {
      return NextResponse.json(
        {
          error:
            "Les sous-titres doivent être terminés avant l'envoi pour validation (le client doit voir la vidéo finale).",
        },
        { status: 400 },
      );
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
