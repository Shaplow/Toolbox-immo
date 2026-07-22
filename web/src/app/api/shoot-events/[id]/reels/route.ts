/**
 * POST /api/shoot-events/[id]/reels — attache un reel (PublicationSlot) à un
 * événement de tournage. Autorisé pour ADMIN, MONTEUR et VIDEASTE ayant accès à
 * l'événement (le nombre de reels n'est pas connu à l'avance : on en ajoute au
 * fil de l'eau, notamment le monteur au découpage des rushs).
 *
 * Auth : getUserContext(). Gating dans eventService.attachReelToEvent.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import {
  attachReelToEvent,
  type AttachReelInput,
} from "@/lib/services/event/eventService";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const { id: eventId } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v : null;

  const input: AttachReelInput = {
    patternBindingId: str(body.patternBindingId),
    patternTemplateId: str(body.patternTemplateId),
    scheduledAt: str(body.scheduledAt),
    title: str(body.title),
    description: str(body.description),
    propertyId: str(body.propertyId),
    assigneeMonteurId: str(body.assigneeMonteurId),
    assigneeCmId: str(body.assigneeCmId),
    assigneeVideasteId: str(body.assigneeVideasteId),
  };

  try {
    const slot = await attachReelToEvent(eventId, input, userContext);
    return NextResponse.json(slot);
  } catch (err) {
    return mapServiceError(err);
  }
}
