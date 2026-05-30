/**
 * POST /api/validate/[token] — action client externe via magic link.
 *
 * Body : { action: "approve" | "reject" | "cancel", comment?: string }
 *
 * Sécurité :
 *  - Pas d'auth utilisateur — le token EST l'auth.
 *  - Rate-limit basique en mémoire (best-effort, 10/min/IP).
 *  - Token consommé après usage (revoké).
 *  - 404 anti-énumération pour toute erreur de token.
 *
 * Effets :
 *  - approve : AWAITING_CLIENT → SCHEDULED (publi confirmée)
 *  - reject  : AWAITING_CLIENT → CLIENT_REVISION (si allowsClientRevision)
 *              sinon → CANCELLED (refus = annulation si pas de review)
 *  - cancel  : AWAITING_CLIENT → CANCELLED (toujours)
 *
 * Logge un ClientValidationRound + PublicationActivity STATUS_CHANGED.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  verifyClientValidationToken,
  revokeClientValidationTokens,
} from "@/lib/publications/clientValidation";
import { resolveClientValidationConfig } from "@/lib/services/slot/config";
import { logActivity } from "@/lib/services/slot/activity";
import { triggerAutoDescriptionForTranscription } from "@/lib/triggerAutoDescriptionFromTranscription";
import { triggerAutoCoverPackForRender } from "@/lib/coverAuto";

type RouteContext = { params: Promise<{ token: string }> };

const VALID_ACTIONS = ["approve", "reject", "cancel"] as const;
type Action = (typeof VALID_ACTIONS)[number];

const MAX_COMMENT_LENGTH = 2000;

// ─── Rate-limit basique en mémoire ────────────────────────────────────────────
// Best-effort : reset à chaque redémarrage du process. Acceptable pour MVP ;
// pour la prod on remplacera par Redis ou un middleware dédié.

const rateLimits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(ip);
  if (!entry || entry.resetAt < now) {
    rateLimits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: RouteContext) {
  // Rate-limit
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: "Trop de requêtes" }, { status: 429 });
  }

  const { token } = await params;
  const tokenResult = await verifyClientValidationToken(prisma, token);
  if (!tokenResult.valid) {
    // 404 anti-énumération — pas de leak (expired vs revoked vs not_found)
    return NextResponse.json({ error: "Lien invalide" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as { action?: string; comment?: string };
  const action = body.action as Action;
  if (!VALID_ACTIONS.includes(action)) {
    return NextResponse.json(
      { error: `action doit être l'une de : ${VALID_ACTIONS.join(", ")}` },
      { status: 400 },
    );
  }
  if (body.comment && body.comment.length > MAX_COMMENT_LENGTH) {
    return NextResponse.json(
      { error: `comment trop long (max ${MAX_COMMENT_LENGTH})` },
      { status: 400 },
    );
  }

  // Charger le slot pour vérifier l'état + config
  const slot = await prisma.publicationSlot.findUnique({
    where: { id: tokenResult.slotId },
    select: {
      id: true,
      status: true,
      needsClientValidationOverride: true,
      allowsClientRevisionOverride: true,
      pattern: { select: { needsClientValidation: true, allowsClientRevision: true } },
    },
  });
  if (!slot) {
    return NextResponse.json({ error: "Lien invalide" }, { status: 404 });
  }

  if (slot.status !== "AWAITING_CLIENT") {
    return NextResponse.json(
      { error: `Cette publication n'est plus en attente de validation (statut: ${slot.status})` },
      { status: 409 },
    );
  }

  const config = resolveClientValidationConfig(
    {
      needsClientValidationOverride: slot.needsClientValidationOverride,
      allowsClientRevisionOverride: slot.allowsClientRevisionOverride,
    },
    slot.pattern,
  );

  // Reject sans allowsClientRevision = équivalent à cancel
  let effectiveAction = action;
  if (action === "reject" && !config.allowsClientRevision) {
    effectiveAction = "cancel";
  }
  // Si reject avec revision, commentaire obligatoire
  if (effectiveAction === "reject" && !body.comment?.trim()) {
    return NextResponse.json(
      { error: "Un commentaire est requis pour demander des modifications" },
      { status: 400 },
    );
  }

  // Calculer le statut cible et le label round
  const targetStatus =
    effectiveAction === "approve"
      ? "SCHEDULED"
      : effectiveAction === "reject"
        ? "CLIENT_REVISION"
        : "CANCELLED";
  const roundAction =
    effectiveAction === "approve"
      ? "approved"
      : effectiveAction === "reject"
        ? "rejected"
        : "cancelled";

  // Round suivant
  const lastRound = await prisma.clientValidationRound.findFirst({
    where: { slotId: slot.id },
    orderBy: { roundNumber: "desc" },
    select: { roundNumber: true },
  });
  const nextRoundNumber = (lastRound?.roundNumber ?? 0) + 1;

  await prisma.$transaction(async (tx) => {
    await tx.publicationSlot.update({
      where: { id: slot.id },
      data: { status: targetStatus },
    });
    await tx.clientValidationRound.create({
      data: {
        slotId: slot.id,
        roundNumber: nextRoundNumber,
        action: roundAction,
        comment: body.comment?.trim() || null,
      },
    });
  });

  // Révoquer le token (un seul usage par lien)
  await revokeClientValidationTokens(prisma, slot.id);

  // Log activity (actor null = action du client, pas un user app)
  await logActivity(prisma, {
    slotId: slot.id,
    actorId: null,
    type:
      effectiveAction === "approve"
        ? "CLIENT_VALIDATION_APPROVED"
        : effectiveAction === "reject"
          ? "CLIENT_VALIDATION_REJECTED"
          : "CLIENT_VALIDATION_CANCELLED",
    payload: {
      roundNumber: nextRoundNumber,
      comment: body.comment?.trim() ?? null,
      ip: ip !== "unknown" ? ip : undefined,
    },
  });
  await logActivity(prisma, {
    slotId: slot.id,
    actorId: null,
    type: "STATUS_CHANGED",
    payload: {
      from: "AWAITING_CLIENT",
      to: targetStatus,
      trigger:
        effectiveAction === "approve"
          ? "CLIENT_APPROVED"
          : effectiveAction === "reject"
            ? "CLIENT_REJECTED"
            : "CLIENT_CANCELLED",
    },
  });

  // Triggers post-approve (2026-05-30) : maintenant que le client a validé,
  // on lance description auto + cover auto en parallèle. Les helpers
  // `triggerAutoDescription*` et `triggerAutoCover*` ont une garde
  // "post-validation" qui les fait skip si appelés avant SCHEDULED — ici
  // on est juste après le status update vers SCHEDULED, donc ça passe.
  // Fire-and-forget : ne bloque pas la réponse client.
  if (effectiveAction === "approve") {
    void triggerPostValidationJobs(slot.id).catch((err) => {
      console.error(`[validate/${token}] post-validation triggers failed for slot=${slot.id}:`, err);
    });
  }

  return NextResponse.json({ status: targetStatus, roundNumber: nextRoundNumber });
}

/**
 * Déclenche en parallèle (fire-and-forget) les jobs aval qu'on a différés
 * jusqu'à la validation client : description IA et cover pack auto.
 *
 * On résout d'abord les jobs/render associés au slot, puis on appelle les
 * helpers triggers existants — ils sont idempotents (skip si déjà existant
 * ou déjà fait), donc safe en cas de double approve.
 */
async function triggerPostValidationJobs(slotId: string): Promise<void> {
  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: {
      currentVersion: {
        select: {
          id: true,
          fileUrl: true,
          transcriptionJob: { select: { id: true, status: true } },
        },
      },
      // Render lié au slot (uniqueRelation via Render.publicationSlotId).
      // On charge AUSSI la transcription liée au render (pipeline auto_template),
      // car `slot.currentVersion` est null pour ces slots — sans ça, la
      // description IA ne se déclenchait jamais après validation.
      render: {
        select: {
          id: true,
          status: true,
          videoUrl: true,
          templateId: true,
          listing: { select: { userId: true } },
          transcriptionJob: { select: { id: true, status: true } },
        },
      },
    },
  });
  if (!slot) return;

  // Description : prend la transcription côté version (manual_rushes/external)
  // OU côté render (auto_template). Une seule des deux existe en pratique.
  const transcription =
    slot.currentVersion?.transcriptionJob ?? slot.render?.transcriptionJob ?? null;
  if (transcription && transcription.status === "COMPLETED") {
    void triggerAutoDescriptionForTranscription(transcription.id).catch((err) => {
      console.error(`[validate post-approve] triggerAutoDescription échoué slot=${slotId}:`, err);
    });
  }

  // Cover pack : si render DONE avec videoUrl, fire trigger.
  const render = slot.render;
  const sourceVideoUrl = render?.videoUrl ?? slot.currentVersion?.fileUrl ?? null;
  if (render && render.status === "DONE" && sourceVideoUrl && render.listing?.userId) {
    void triggerAutoCoverPackForRender(
      render.id,
      render.templateId,
      sourceVideoUrl,
      render.listing.userId,
    ).catch((err) => {
      console.error(`[validate post-approve] triggerAutoCover échoué slot=${slotId}:`, err);
    });
  }
}
