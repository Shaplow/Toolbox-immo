import { prisma } from "@/lib/prisma";

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
}

/**
 * Génère des PublicationSlot pour les comptes et la plage de dates donnés,
 * en se basant sur les OfferScheduleRule actives.
 * Idempotent : ignore les slots qui existent déjà (même accountId + scheduledAt + contentType).
 */
export async function generateCalendarSlots(
  options: GenerateCalendarOptions
): Promise<GenerateCalendarResult> {
  const { dateFrom, dateTo, accountIds } = options;

  const accounts = await prisma.instagramAccount.findMany({
    where: accountIds ? { id: { in: accountIds } } : undefined,
    select: { id: true, offre: true },
  });

  if (accounts.length === 0) return { created: 0, skipped: 0 };

  const rules = await prisma.offerScheduleRule.findMany({
    where: { isActive: true },
  });

  if (rules.length === 0) return { created: 0, skipped: 0 };

  // Index des règles par offre
  const rulesByOffre = new Map<string, typeof rules>();
  for (const rule of rules) {
    const list = rulesByOffre.get(rule.offre) ?? [];
    list.push(rule);
    rulesByOffre.set(rule.offre, list);
  }

  const slotsToCreate: Array<{
    accountId: string;
    scheduledAt: Date;
    contentType: string;
    isAuto: boolean;
  }> = [];

  // All date arithmetic is UTC so the engine is timezone-agnostic regardless
  // of the server's local timezone. publishTime ("HH:MM") is treated as UTC.
  const current = new Date(dateFrom);
  current.setUTCHours(0, 0, 0, 0);
  const end = new Date(dateTo);
  end.setUTCHours(23, 59, 59, 999);

  while (current <= end) {
    // getUTCDay(): 0=Dim, 1=Lun … 6=Sam → converti en ISO 1=Lun … 7=Dim
    const jsDay = current.getUTCDay();
    const isoDay = jsDay === 0 ? 7 : jsDay;

    for (const account of accounts) {
      const accountRules = rulesByOffre.get(account.offre) ?? [];
      const dayRules = accountRules.filter((r) => r.dayOfWeek === isoDay);

      for (const rule of dayRules) {
        const [hours, minutes] = rule.publishTime.split(":").map(Number);
        const scheduledAt = new Date(current);
        scheduledAt.setUTCHours(hours!, minutes!, 0, 0);

        slotsToCreate.push({
          accountId: account.id,
          scheduledAt: new Date(scheduledAt),
          contentType: rule.contentType,
          isAuto: true,
        });
      }
    }

    current.setUTCDate(current.getUTCDate() + 1);
  }

  if (slotsToCreate.length === 0) return { created: 0, skipped: 0 };

  // Chargement des slots existants sur la même plage pour déduplication
  const existingSlots = await prisma.publicationSlot.findMany({
    where: {
      accountId: { in: accounts.map((a) => a.id) },
      scheduledAt: { gte: dateFrom, lte: dateTo },
    },
    select: { accountId: true, scheduledAt: true, contentType: true },
  });

  const existingKeys = new Set(
    existingSlots.map(
      (s) => `${s.accountId}|${s.scheduledAt.toISOString()}|${s.contentType}`
    )
  );

  const newSlots = slotsToCreate.filter(
    (s) =>
      !existingKeys.has(
        `${s.accountId}|${s.scheduledAt.toISOString()}|${s.contentType}`
      )
  );

  const skipped = slotsToCreate.length - newSlots.length;

  if (newSlots.length > 0) {
    await prisma.publicationSlot.createMany({ data: newSlots });
  }

  return { created: newSlots.length, skipped };
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
