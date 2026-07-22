/**
 * GET  /api/shoot-events   — liste des événements de tournage (scopée par rôle).
 * POST /api/shoot-events   — création d'un événement (ADMIN réel uniquement).
 *
 * Auth : getUserContext(). Le scoping/gating vit dans eventService/eventScope.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import {
  createEvent,
  listEvents,
  toShootEventSummary,
  type CreateEventInput,
} from "@/lib/services/event/eventService";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";

export async function GET(req: NextRequest) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  try {
    const events = await listEvents(
      {
        dateFrom: searchParams.get("dateFrom"),
        dateTo: searchParams.get("dateTo"),
        accountId: searchParams.get("accountId"),
        status: searchParams.get("status"),
      },
      userContext,
    );
    return NextResponse.json({ events: events.map(toShootEventSummary) });
  } catch (err) {
    return mapServiceError(err);
  }
}

export async function POST(req: NextRequest) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v : null;

  const input: CreateEventInput = {
    title: typeof body.title === "string" ? body.title : "",
    accountId: typeof body.accountId === "string" ? body.accountId : "",
    propertyId: str(body.propertyId),
    scheduledAt: typeof body.scheduledAt === "string" ? body.scheduledAt : "",
    endAt: str(body.endAt),
    assigneeVideasteId: str(body.assigneeVideasteId),
    defaultAssigneeMonteurId: str(body.defaultAssigneeMonteurId),
    defaultAssigneeCmId: str(body.defaultAssigneeCmId),
    notes: str(body.notes),
    brief: str(body.brief),
  };

  try {
    const event = await createEvent(input, userContext);
    return NextResponse.json(event);
  } catch (err) {
    return mapServiceError(err);
  }
}
