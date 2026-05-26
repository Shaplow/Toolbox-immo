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

/**
 * Génère des PublicationSlots pour la plage [dateFrom, dateTo] à partir des AccountPattern actifs.
 *
 * Idempotence : si un slot existe déjà pour le même (accountId, scheduledAt, patternId),
 * il est ignoré (skipped). Appelable plusieurs fois sur la même semaine sans doublon.
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

  // 2. Calculer les dates cibles et créer les slots manquants
  let created = 0;
  let skipped = 0;

  // Chercher le lundi de la semaine contenant dateFrom (normalisation)
  // On itère sur les jours de la plage pour couvrir toute la fenêtre fournie
  const weekStartMs = dateFrom.getTime();

  for (const pattern of patterns) {
    // dayOfWeek : 1=Lundi … 7=Dimanche
    // dateFrom est supposé être le lundi de la semaine (UTC)
    const targetDate = new Date(weekStartMs);
    targetDate.setUTCDate(targetDate.getUTCDate() + (pattern.dayOfWeek - 1));

    // Appliquer publishTime (format "HH:MM")
    const [hours, minutes] = pattern.publishTime.split(":").map(Number);
    targetDate.setUTCHours(hours, minutes, 0, 0);

    // Ignorer si hors plage (guard pour les cas où dateFrom n'est pas un lundi strict)
    if (targetDate < dateFrom || targetDate > dateTo) {
      continue;
    }

    // Vérification d'idempotence : slot déjà existant pour ce compte/date/pattern
    const existing = await prisma.publicationSlot.findFirst({
      where: {
        accountId: pattern.accountId,
        scheduledAt: targetDate,
        patternId: pattern.id,
      },
      select: { id: true },
    });

    if (existing) {
      skipped++;
      continue;
    }

    // Créer le slot
    await prisma.publicationSlot.create({
      data: {
        accountId: pattern.accountId,
        scheduledAt: targetDate,
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
      },
    });
    created++;
  }

  return { created, skipped };
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
