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
  note?: string;
}

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Normalise une date vers le lundi 00:00:00 UTC de sa semaine.
 * dayOfWeek interne : 1=Lundi … 7=Dimanche (cohérent avec AccountPattern.dayOfWeek).
 */
function toMondayUTC(d: Date): Date {
  const jsDay = d.getUTCDay(); // 0=Dim, 1=Lun, …, 6=Sam
  const dayOfWeek = jsDay === 0 ? 7 : jsDay; // 1=Lun, 7=Dim
  const daysToSubtract = dayOfWeek - 1;
  const mon = new Date(d);
  mon.setUTCDate(d.getUTCDate() - daysToSubtract);
  mon.setUTCHours(0, 0, 0, 0);
  return mon;
}

/**
 * Génère des PublicationSlots pour la plage [dateFrom, dateTo] à partir des AccountPattern actifs.
 *
 * Supporte plusieurs semaines : itère sur chaque lundi entre `toMondayUTC(dateFrom)` et
 * `toMondayUTC(dateTo)` inclus, et matérialise chaque pattern actif pour ce lundi.
 *
 * Idempotence : si un slot existe déjà pour le même (accountId, scheduledAt, patternId),
 * il est ignoré. Implémenté via une seule requête bulk + filtrage en mémoire (pas de N+1).
 *
 * Performance : 2 requêtes DB au total (findMany existing + createMany) au lieu de 2N.
 */
export async function generateCalendarSlots(
  options: GenerateCalendarOptions
): Promise<GenerateCalendarResult> {
  const { accountIds, dateFrom, dateTo } = options;

  // 1. Récupérer tous les patterns actifs (filtrés par compte si précisé)
  const patterns = await prisma.accountPattern.findMany({
    where: {
      isActive: true,
      ...(accountIds && accountIds.length > 0 ? { accountId: { in: accountIds } } : {}),
    },
    select: {
      id: true,
      accountId: true,
      label: true,
      dayOfWeek: true,
      publishTime: true,
      templateId: true,
      defaultAssigneeMonteurId: true,
      defaultAssigneeCmId: true,
    },
  });

  if (patterns.length === 0) {
    return { created: 0, skipped: 0 };
  }

  // 2. Calculer toutes les dates cibles sur l'ensemble des semaines de la plage
  type TargetSlot = {
    pattern: typeof patterns[number];
    scheduledAt: Date;
  };
  const targets: TargetSlot[] = [];

  const startMondayMs = toMondayUTC(dateFrom).getTime();
  const endMondayMs = toMondayUTC(dateTo).getTime();

  for (let weekMs = startMondayMs; weekMs <= endMondayMs; weekMs += ONE_WEEK_MS) {
    for (const pattern of patterns) {
      const targetDate = new Date(weekMs);
      targetDate.setUTCDate(targetDate.getUTCDate() + (pattern.dayOfWeek - 1));
      const [hours, minutes] = pattern.publishTime.split(":").map(Number);
      targetDate.setUTCHours(hours, minutes, 0, 0);

      // Skip si en dehors de la plage demandée (utile aux bords semaine partielle)
      if (targetDate < dateFrom || targetDate > dateTo) continue;

      targets.push({ pattern, scheduledAt: targetDate });
    }
  }

  if (targets.length === 0) {
    return { created: 0, skipped: 0 };
  }

  // 3. Bulk fetch des slots existants pour ces patterns sur la plage
  const patternIds = patterns.map((p) => p.id);
  const existing = await prisma.publicationSlot.findMany({
    where: {
      patternId: { in: patternIds },
      scheduledAt: { gte: dateFrom, lte: dateTo },
    },
    select: { accountId: true, scheduledAt: true, patternId: true },
  });

  // Index : "accountId|scheduledAtMs|patternId"
  const existingKeys = new Set(
    existing.map((s) => `${s.accountId}|${s.scheduledAt.getTime()}|${s.patternId}`)
  );

  // 4. Filtrer les cibles qui n'existent pas encore
  const toCreate = targets.filter(({ pattern, scheduledAt }) => {
    const key = `${pattern.accountId}|${scheduledAt.getTime()}|${pattern.id}`;
    return !existingKeys.has(key);
  });

  // 5. Bulk insert
  if (toCreate.length > 0) {
    await prisma.publicationSlot.createMany({
      data: toCreate.map(({ pattern, scheduledAt }) => ({
        accountId: pattern.accountId,
        scheduledAt,
        patternId: pattern.id,
        // contentType : utilise pattern.label (champ legacy String) — à nettoyer en Wave E
        contentType: pattern.label,
        status: "TO_DO",
        templateId: pattern.templateId ?? null,
        assigneeMonteurId: pattern.defaultAssigneeMonteurId ?? null,
        assigneeCmId: pattern.defaultAssigneeCmId ?? null,
        isAuto: true,
        fields: "{}",
        fieldSchema: "[]",
      })),
    });
  }

  return {
    created: toCreate.length,
    skipped: targets.length - toCreate.length,
  };
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
