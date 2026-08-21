/**
 * POST /api/orders/[id]/validate — validation admin d'une commande.
 * Approuve les fiches en attente, passe la commande VALIDATED, puis instancie
 * les slots (banque, sans date). Retourne { order, createdSlotIds, failed } —
 * l'UI DOIT afficher `failed` (échecs isolés par recette).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import { validateOrder } from "@/lib/services/order/orderService";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const { id } = await params;
  try {
    const result = await validateOrder(id, auth.ctx);
    return NextResponse.json(result);
  } catch (err) {
    return mapServiceError(err);
  }
}
