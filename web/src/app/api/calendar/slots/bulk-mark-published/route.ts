/**
 * POST /api/calendar/slots/bulk-mark-published
 *
 * Marque N slots calendrier comme publiés. Admin only.
 * Body : { slotIds: string[], publishedAt?: string ISO }
 *
 * Pas d'URL Instagram : elle est propre à chaque post, un lot ne peut pas la
 * fournir. Les slots sortent « publiés sans lien », signalés comme tels, et le
 * lien reste ajoutable depuis chaque fiche.
 *
 * Route dédiée plutôt que bulk-patch : le passage à PUBLISHED doit poser
 * publishedAt et logger une activité PUBLISHED (bulk-patch le refuse
 * explicitement, comme patchSlot).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { bulkMarkPublishedSlots } from "@/lib/services/slot/slotService";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const ctx = auth.ctx;

  let body: { slotIds?: string[]; publishedAt?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  try {
    const result = await bulkMarkPublishedSlots(
      { slotIds: body.slotIds ?? [], publishedAt: body.publishedAt },
      ctx,
    );
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return mapServiceError(err);
  }
}
