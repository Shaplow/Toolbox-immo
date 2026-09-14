/**
 * GET /api/cron/calendar — génère les slots de la semaine suivante.
 * Protégé par Authorization: Bearer <CRON_SECRET>.
 * Configurer le cron pour appeler cet endpoint chaque vendredi ou dimanche soir.
 *
 * `?dryRun=1` n'écrit rien et retourne le même diagnostic (`created`, `skipped`,
 * `skips`) : c'est la façon sûre de demander à la prod pourquoi elle ne génère
 * rien, sans créer la semaine par accident en posant la question.
 */
import { NextRequest, NextResponse } from "next/server";
import { generateCalendarSlots, nextWeekRange } from "@/lib/calendarEngine";
import { timingSafeEqualStrings } from "@/lib/utils";

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET non configuré" }, { status: 500 });
  }

  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!timingSafeEqualStrings(token, cronSecret)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { dateFrom, dateTo } = nextWeekRange();
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";

  const result = await generateCalendarSlots({ dateFrom, dateTo, dryRun });

  return NextResponse.json({
    ok: true,
    dryRun,
    week: { dateFrom: dateFrom.toISOString(), dateTo: dateTo.toISOString() },
    ...result,
  });
}
