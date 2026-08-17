/**
 * POST /api/calendar/slots/bulk-schedule
 *
 * Sprint B — Programme en lot N slots banque vers le calendrier.
 * Body : { slotIds, startDateTimeISO (ISO 8601), spreadOverDays?, useBindingTime? }
 * Admin only.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { bulkScheduleSlots } from "@/lib/services/slot/slotService";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;

  let body: {
    slotIds?: string[];
    startDateTimeISO?: string;
    spreadOverDays?: number;
    useBindingTime?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  try {
    const result = await bulkScheduleSlots(
      {
        slotIds: body.slotIds ?? [],
        startDateTimeISO: body.startDateTimeISO ?? "",
        spreadOverDays: body.spreadOverDays,
        useBindingTime: body.useBindingTime,
      },
      userContext,
    );
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return mapServiceError(err);
  }
}
