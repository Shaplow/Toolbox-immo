/**
 * POST /api/calendar/slots/bulk-stock
 *
 * Crée N slots "en banque" (scheduledAt: null) pour un pattern manual_rushes
 * donné. Cas d'usage : l'admin met le monteur sur des missions à produire
 * sans imposer de date — les contenus prêts s'accumulent dans la vue Banque
 * du calendar et seront planifiés plus tard.
 *
 * Auth : ADMIN uniquement (canAdminBypass). L'impersonation ne suffit pas.
 * Validation : pattern.source === "manual_rushes" + pattern appartient au compte.
 *
 * Body : { accountId, patternId, quantity, monteurId? }
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { bulkStockSlots } from "@/lib/services/slot/slotService";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";

export async function POST(req: NextRequest) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  let body: {
    accountId?: string;
    patternId?: string;
    quantity?: number;
    monteurId?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  try {
    const result = await bulkStockSlots(
      {
        accountId: body.accountId ?? "",
        patternId: body.patternId ?? "",
        quantity: typeof body.quantity === "number" ? body.quantity : Number(body.quantity ?? 0),
        monteurId: body.monteurId ?? null,
      },
      userContext,
    );
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return mapServiceError(err);
  }
}
