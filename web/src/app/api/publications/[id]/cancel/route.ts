/**
 * POST /api/publications/[id]/cancel — retire une publication du pipeline.
 *
 * Body : { reason: string } — motif obligatoire.
 *
 * Route dédiée plutôt qu'un PATCH `status: "CANCELLED"` : ce statut fait partie
 * des terminaux réservés à l'ADMIN via PATCH (cf. RESERVED_TERMINAL_STATUSES
 * dans slotService), et les ouvrir au monteur ouvrirait du même coup ARCHIVED
 * et PUBLISHED. Même raisonnement que /mark-published.
 *
 * Auth : 404 hors périmètre (anti-énumération), 403 si le rôle ne peut pas
 * retirer (cf. canCancelSlot : ADMIN, MONTEUR, VIDEASTE — pas le CM).
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { cancelSlot } from "@/lib/services/slot/slotService";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { reason?: unknown };
  const reason = typeof body.reason === "string" ? body.reason : "";

  try {
    const slot = await cancelSlot(id, reason, userContext);
    return NextResponse.json({ ok: true, slot });
  } catch (err) {
    return mapServiceError(err);
  }
}
