/**
 * GET /api/cron/calendar — génère les slots de la semaine suivante.
 * Protégé par Authorization: Bearer <CRON_SECRET>.
 * Configurer le cron pour appeler cet endpoint chaque vendredi ou dimanche soir.
 */
import { NextRequest, NextResponse } from "next/server";
import { generateCalendarSlots, nextWeekRange } from "@/lib/calendarEngine";

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET non configuré" }, { status: 500 });
  }

  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (token !== cronSecret) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { dateFrom, dateTo } = nextWeekRange();

  const result = await generateCalendarSlots({ dateFrom, dateTo });

  return NextResponse.json({
    ok: true,
    week: { dateFrom: dateFrom.toISOString(), dateTo: dateTo.toISOString() },
    ...result,
  });
}
