/**
 * POST /api/admin/publications/[id]/manual-validate — escape hatch ADMIN
 *
 * Marque un slot comme validé manuellement par l'ADMIN (sans passer par
 * le magic link). Utile si le client a validé par téléphone/whatsapp et
 * qu'on veut juste avancer le slot. Révoque le token actif au passage.
 *
 * Body : { action: "approve" | "cancel", comment?: string }
 *  - approve → SCHEDULED (équivalent à client.approve)
 *  - cancel  → CANCELLED (équivalent à client.cancel ou rejet final)
 *
 * Slot doit être en AWAITING_CLIENT, CLIENT_REVISION ou READY_FOR_CM.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/services/slot/activity";
import { revokeClientValidationTokens } from "@/lib/publications/clientValidation";

type RouteContext = { params: Promise<{ id: string }> };

const VALID_ACTIONS = ["approve", "cancel"] as const;
type Action = (typeof VALID_ACTIONS)[number];

const ALLOWED_FROM_STATUSES = ["AWAITING_CLIENT", "CLIENT_REVISION", "READY_FOR_CM"];

export async function POST(req: NextRequest, { params }: RouteContext) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { action?: string; comment?: string };
  const action = body.action as Action;
  if (!VALID_ACTIONS.includes(action)) {
    return NextResponse.json(
      { error: `action doit être l'une de : ${VALID_ACTIONS.join(", ")}` },
      { status: 400 },
    );
  }

  const { id: slotId } = await params;
  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: { id: true, status: true },
  });
  if (!slot) return NextResponse.json({ error: "Slot introuvable" }, { status: 404 });

  if (!ALLOWED_FROM_STATUSES.includes(slot.status)) {
    return NextResponse.json(
      { error: `Slot dans un statut incompatible (${slot.status})` },
      { status: 400 },
    );
  }

  const targetStatus = action === "approve" ? "SCHEDULED" : "CANCELLED";
  const actorId = userContext.actualUser.id;

  // Round suivant (pour traçabilité dans l'historique)
  const lastRound = await prisma.clientValidationRound.findFirst({
    where: { slotId },
    orderBy: { roundNumber: "desc" },
    select: { roundNumber: true },
  });
  const nextRoundNumber = (lastRound?.roundNumber ?? 0) + 1;

  await prisma.$transaction(async (tx) => {
    await tx.publicationSlot.update({
      where: { id: slotId },
      data: { status: targetStatus },
    });
    await tx.clientValidationRound.create({
      data: {
        slotId,
        roundNumber: nextRoundNumber,
        action: action === "approve" ? "approved" : "cancelled",
        comment: body.comment?.trim() || `Validation manuelle par admin (${action})`,
      },
    });
  });

  // Révoquer tout token actif (le lien n'a plus de raison d'être)
  await revokeClientValidationTokens(prisma, slotId);

  await logActivity(prisma, {
    slotId,
    actorId,
    type: "STATUS_CHANGED",
    payload: {
      from: slot.status,
      to: targetStatus,
      trigger: action === "approve" ? "CLIENT_MANUAL_APPROVED" : "CLIENT_MANUAL_CANCELLED",
      comment: body.comment ?? null,
    },
  });

  return NextResponse.json({ status: targetStatus, roundNumber: nextRoundNumber });
}
