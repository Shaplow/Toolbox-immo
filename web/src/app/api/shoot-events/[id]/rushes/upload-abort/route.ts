/**
 * POST /api/shoot-events/[id]/rushes/upload-abort
 *
 * Annule un upload multipart en cours (rush événement) et libère le stockage
 * partiel R2. Auth : getUserContext(). Permission : canUploadEventRushes.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { canUploadEventRushes } from "@/lib/permissions/eventScope";
import { toUserRole } from "@/lib/permissions/role";
import { abortMultipartUpload } from "@/lib/r2Multipart";
import { loadEventForAccess } from "@/lib/services/event/eventRushAccess";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id: eventId } = await params;

  const event = await loadEventForAccess(eventId);
  if (!event || !canUploadEventRushes(event, role, userId)) {
    return NextResponse.json({ error: "Événement introuvable" }, { status: 404 });
  }

  const body = (await req.json()) as { r2Key?: string; uploadId?: string };
  const { r2Key, uploadId } = body;

  if (!r2Key || typeof r2Key !== "string") {
    return NextResponse.json({ error: "Le champ 'r2Key' est requis" }, { status: 400 });
  }
  if (!uploadId || typeof uploadId !== "string") {
    return NextResponse.json({ error: "Le champ 'uploadId' est requis" }, { status: 400 });
  }
  if (!r2Key.startsWith(`shoot-events/${eventId}/`)) {
    return NextResponse.json({ error: "Clé R2 non autorisée pour cet événement" }, { status: 403 });
  }

  try {
    await abortMultipartUpload(r2Key, uploadId);
  } catch (err) {
    console.error(`[event upload-abort] failed key=${r2Key} uploadId=${uploadId}:`, err);
    return NextResponse.json({ error: "Échec de l'annulation de l'upload" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
