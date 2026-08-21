/**
 * GET /api/orders/[id] — détail d'une commande (scopé, 404 anti-énumération).
 * Vue role-aware : l'externe reçoit les slots simplifiés (macro-étape), sans
 * internals du pipeline.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { getOrder } from "@/lib/services/order/orderService";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const { id } = await params;
  try {
    const order = await getOrder(id, auth.ctx);
    return NextResponse.json(order);
  } catch (err) {
    return mapServiceError(err);
  }
}
