/**
 * POST /api/calendar/renders/preview
 *
 * Aperçu d'un lancement de rendus en lot depuis le calendrier — admin only.
 * Body : { slotIds: string[] }
 *
 * Tire les médias de chaque publication comme si les rendus avaient été
 * lancés un par un dans l'ordre du calendrier (registre d'usage virtuel,
 * `lib/rotation/batchUsage.ts`) — ne réserve rien en base.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { previewBulkRenders } from "@/lib/services/render/bulkRenderService";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const ctx = auth.ctx;

  let body: { slotIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  // `req.json()` accepte `null`/un tableau/un scalaire — `body.slotIds`
  // planterait alors avec un TypeError non catché (500 au lieu du 400 voulu).
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  if (!Array.isArray(body.slotIds) || !body.slotIds.every((id) => typeof id === "string")) {
    return NextResponse.json({ error: "slotIds (string[]) requis" }, { status: 400 });
  }

  try {
    const preview = await previewBulkRenders(body.slotIds, ctx);
    return NextResponse.json(preview, { status: 200 });
  } catch (err) {
    return mapServiceError(err);
  }
}
