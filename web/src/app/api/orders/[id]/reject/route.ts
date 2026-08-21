/**
 * POST /api/orders/[id]/reject — refus admin d'une commande (motif requis).
 * Body : { reason }. Les fiches PENDING_ADMIN passent REJECTED ; le client
 * peut corriger puis re-soumettre.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import { rejectOrder } from "@/lib/services/order/orderService";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  try {
    const order = await rejectOrder(id, typeof body.reason === "string" ? body.reason : "", auth.ctx);
    return NextResponse.json(order);
  } catch (err) {
    return mapServiceError(err);
  }
}
