/**
 * PATCH /api/orders/[id]/entities/[entityId] — édition d'une fiche de commande
 * par le client (ou l'admin). Whitelist {label, fields, scheduledAt}, statut
 * commande ∈ SUBMITTED|REJECTED. Le gating vit dans orderService.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { updateOrderEntity } from "@/lib/services/order/orderService";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";

type Params = { params: Promise<{ id: string; entityId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const { id, entityId } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const patch: Parameters<typeof updateOrderEntity>[2] = {};
  if (typeof body.label === "string") patch.label = body.label;
  if (body.fields !== undefined && typeof body.fields === "object" && body.fields !== null) {
    patch.fields = body.fields as Record<string, string>;
  }
  if (body.scheduledAt !== undefined) {
    patch.scheduledAt = typeof body.scheduledAt === "string" ? body.scheduledAt : null;
  }

  try {
    const order = await updateOrderEntity(id, entityId, patch, auth.ctx);
    return NextResponse.json(order);
  } catch (err) {
    return mapServiceError(err);
  }
}
