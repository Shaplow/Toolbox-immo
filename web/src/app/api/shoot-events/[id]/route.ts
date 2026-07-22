/**
 * GET    /api/shoot-events/[id] — détail d'un événement (scopé, 404 anti-énum).
 * PATCH  /api/shoot-events/[id] — mise à jour (champs filtrés par rôle).
 * DELETE /api/shoot-events/[id] — suppression / soft-cancel (ADMIN réel).
 *
 * Auth : getUserContext(). Gating dans eventService/eventScope.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import {
  deleteEvent,
  getEvent,
  updateEvent,
} from "@/lib/services/event/eventService";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const { id } = await params;
  try {
    const event = await getEvent(id, userContext);
    return NextResponse.json({ event });
  } catch (err) {
    return mapServiceError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  try {
    const event = await updateEvent(id, body, userContext);
    return NextResponse.json(event);
  } catch (err) {
    return mapServiceError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const { id } = await params;
  try {
    const result = await deleteEvent(id, userContext);
    return NextResponse.json(result);
  } catch (err) {
    return mapServiceError(err);
  }
}
