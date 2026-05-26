export interface GenerateCalendarOptions {
  /** Si omis, génère pour tous les comptes actifs */
  accountIds?: string[];
  dateFrom: Date;
  dateTo: Date;
}

export interface GenerateCalendarResult {
  created: number;
  /** Slots déjà existants, ignorés */
  skipped: number;
  note?: string;
}

/**
 * STUB — Phase 1.6 patterns redesign.
 *
 * generateCalendarSlots était basé sur OfferScheduleRule (supprimé en Wave A1).
 * Cette implémentation sera réécrite en Wave B pour s'appuyer sur AccountPattern.
 */
export async function generateCalendarSlots(
  _options: GenerateCalendarOptions
): Promise<GenerateCalendarResult> {
  console.warn(
    "[calendarEngine] generateCalendarSlots is disabled during Phase 1.6 patterns redesign. " +
    "Slot auto-generation will be re-enabled in Wave B once AccountPattern integration is done."
  );
  return { created: 0, skipped: 0, note: "Disabled during patterns redesign" };
}

/** Retourne la plage [lundi, dimanche] de la semaine suivante (UTC) */
export function nextWeekRange(): { dateFrom: Date; dateTo: Date } {
  const now = new Date();
  const jsDay = now.getUTCDay(); // 0=Dim
  const daysUntilNextMonday = jsDay === 0 ? 1 : 8 - jsDay;

  const dateFrom = new Date(now);
  dateFrom.setUTCDate(now.getUTCDate() + daysUntilNextMonday);
  dateFrom.setUTCHours(0, 0, 0, 0);

  const dateTo = new Date(dateFrom);
  dateTo.setUTCDate(dateFrom.getUTCDate() + 6);
  dateTo.setUTCHours(23, 59, 59, 999);

  return { dateFrom, dateTo };
}
