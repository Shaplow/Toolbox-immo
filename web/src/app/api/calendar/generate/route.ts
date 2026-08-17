/**
 * POST /api/calendar/generate — génère les slots pour une plage de dates (admin uniquement)
 *
 * Body: { accountIds?: string[], dateFrom: string (ISO), dateTo: string (ISO) }
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import { generateCalendarSlots } from "@/lib/calendarEngine";

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  const body = await req.json();
  const { accountIds, dateFrom, dateTo } = body;

  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: "dateFrom et dateTo sont requis" }, { status: 400 });
  }

  const from = new Date(dateFrom);
  const to = new Date(dateTo);

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return NextResponse.json({ error: "Dates invalides" }, { status: 400 });
  }

  if (from > to) {
    return NextResponse.json({ error: "dateFrom doit être antérieure à dateTo" }, { status: 400 });
  }

  const MAX_RANGE_DAYS = 90;
  const diffDays = Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { error: `La plage ne peut pas dépasser ${MAX_RANGE_DAYS} jours` },
      { status: 400 }
    );
  }

  // Empêche la génération rétroactive : si toute la plage est dans le passé,
  // on refuse avec un message explicite. Si la plage chevauche maintenant
  // (cas semaine courante), on tronque côté engine via dateFrom = max(from, now).
  const now = new Date();
  if (to <= now) {
    return NextResponse.json(
      {
        error:
          "Plage entièrement passée — la génération auto ne crée pas de slots rétroactifs.",
      },
      { status: 400 },
    );
  }
  const effectiveFrom = from > now ? from : now;

  // Dry-run : query param ?dry=true → engine retourne created/skipped sans
  // créer en base. Permet à l'UI d'afficher un résumé avant confirmation
  // (W4.9, finding cross-ux-3).
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry") === "true";

  const result = await generateCalendarSlots({
    accountIds: Array.isArray(accountIds) ? accountIds : undefined,
    dateFrom: effectiveFrom,
    dateTo: to,
    dryRun,
  });

  return NextResponse.json({ ...result, dryRun });
}
