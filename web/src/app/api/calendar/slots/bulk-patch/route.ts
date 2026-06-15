/**
 * POST /api/calendar/slots/bulk-patch
 *
 * Sprint C — Patch commun appliqué à N slots calendrier.
 * Body : { slotIds: string[], patch: { assigneeMonteurId?, assigneeCmId?, assigneeVideasteId?, scheduledAt?, status? } }
 * Admin only.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { bulkPatchSlots } from "@/lib/services/slot/slotService";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  let body: { slotIds?: string[]; patch?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  try {
    const result = await bulkPatchSlots(
      {
        slotIds: body.slotIds ?? [],
        patch: (body.patch ?? {}) as Parameters<typeof bulkPatchSlots>[0]["patch"],
      },
      ctx,
    );
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return mapServiceError(err);
  }
}
