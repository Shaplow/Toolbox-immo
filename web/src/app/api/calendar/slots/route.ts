/**
 * GET  /api/calendar/slots — liste les slots avec filtres, scopée par rôle
 * POST /api/calendar/slots — création manuelle d'un slot (admin uniquement)
 *
 * Filtrage par rôle :
 *   ADMIN              → tous les slots (aucune restriction)
 *   MONTEUR            → uniquement les slots dont assigneeMonteurId = userId
 *   CM                 → uniquement les slots dont assigneeCmId = userId
 *   VIDEASTE           → uniquement les slots dont assigneeVideasteId = userId
 *   EXTERNAL_GENERATOR → 403 (aucun accès pipeline)
 *
 * L'impersonation s'applique : la vue est celle de effectiveUser. Un admin qui
 * impersonne un MONTEUR voit uniquement les slots assignés à ce MONTEUR.
 *
 * Logique métier :
 *  - GET  → `services/slot/slotService.listSlots`
 *  - POST → `services/slot/slotService.createSlot`
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { createSlot, listSlots } from "@/lib/services/slot/slotService";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";

export async function GET(req: NextRequest) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);

  try {
    const result = await listSlots(
      {
        accountId: searchParams.get("accountId") ?? undefined,
        status: searchParams.get("status") ?? undefined,
        patternId: searchParams.get("patternId") ?? undefined,
        monteurId: searchParams.get("monteurId") ?? undefined,
        cmId: searchParams.get("cmId") ?? undefined,
        videasteId: searchParams.get("videasteId") ?? undefined,
        dateFrom: searchParams.get("dateFrom") ?? undefined,
        dateTo: searchParams.get("dateTo") ?? undefined,
      },
      userContext,
    );
    return NextResponse.json(result);
  } catch (err) {
    return mapServiceError(err);
  }
}

export async function POST(req: NextRequest) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const body = await req.json();
  try {
    const slot = await createSlot(body, userContext);
    return NextResponse.json(slot);
  } catch (err) {
    return mapServiceError(err);
  }
}
