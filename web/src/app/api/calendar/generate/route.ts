/**
 * POST /api/calendar/generate — génère les slots pour une plage de dates (admin uniquement)
 *
 * Body: { accountIds?: string[], dateFrom: string (ISO), dateTo: string (ISO) }
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateCalendarSlots } from "@/lib/calendarEngine";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
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

  const result = await generateCalendarSlots({
    accountIds: Array.isArray(accountIds) ? accountIds : undefined,
    dateFrom: from,
    dateTo: to,
  });

  return NextResponse.json(result);
}
