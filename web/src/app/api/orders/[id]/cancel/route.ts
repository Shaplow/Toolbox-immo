/**
 * POST /api/orders/[id]/cancel — annulation. Client : tant que SUBMITTED ;
 * admin : toujours, 409 si des publications actives sont liées.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { cancelOrder } from "@/lib/services/order/orderService";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const { id } = await params;
  try {
    const order = await cancelOrder(id, auth.ctx);
    return NextResponse.json(order);
  } catch (err) {
    return mapServiceError(err);
  }
}
