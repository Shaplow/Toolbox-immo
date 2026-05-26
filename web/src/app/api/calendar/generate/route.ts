/**
 * POST /api/calendar/generate — génère les slots pour une plage de dates (admin uniquement)
 *
 * Body: { accountIds?: string[], dateFrom: string (ISO), dateTo: string (ISO) }
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { generateCalendarSlots } from "@/lib/calendarEngine";

export async function POST(req: NextRequest) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

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

  const result = await generateCalendarSlots({
    accountIds: Array.isArray(accountIds) ? accountIds : undefined,
    dateFrom: from,
    dateTo: to,
  });

  return NextResponse.json(result);
}
