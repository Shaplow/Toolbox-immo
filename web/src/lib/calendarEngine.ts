import { prisma } from "@/lib/prisma";
import { patternLabel } from "@/lib/services/pattern/resolveEffective";
import type { SlotStatus } from "@/types/roles";

/**
 * Détermine le statut initial d'un slot fraîchement créé selon le mode de
 * production défini par le pattern.
 *
 * - `auto_template`   → `PLANNED` : l'auto-transition pipeline prendra le relais
 *                       dès qu'un render sera lancé (TO_DO → IN_PROGRESS → READY_FOR_CM)
 * - `manual_rushes`   → `RUSHES_EXPECTED` : visible immédiatement chez le MONTEUR
 *                       qui doit uploader des rushes
 * - `external_upload` → `READY_FOR_CM` : pas de montage attendu, le CM prend le relais
 *
 * Si `source` est inconnu (donnée corrompue ou évolution future non gérée), on
 * retombe sur `PLANNED` avec un warn console — pas de cassure.
 */
export function mapSourceToInitialStatus(source: string): SlotStatus {
  switch (source) {
    case "auto_template":
      return "PLANNED";
    case "manual_rushes":
      return "RUSHES_EXPECTED";
    case "external_upload":
      return "READY_FOR_CM";
    default:
      console.warn(
        `[calendarEngine] Source pattern inconnue "${source}" — fallback sur PLANNED`,
      );
      return "PLANNED";
  }
}

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
 * dayOfWeek interne : 1=Lundi … 7=Dimanche (cohérent avec PatternBinding.dayOfWeek).
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
 * Génère des PublicationSlots pour la plage [dateFrom, dateTo] à partir des PatternBinding actifs.
 *
 * Supporte plusieurs semaines : itère sur chaque lundi entre `toMondayUTC(dateFrom)` et
 * `toMondayUTC(dateTo)` inclus, et matérialise chaque pattern actif pour ce lundi.
 *
 * Idempotence : si un slot existe déjà pour le même (accountId, scheduledAt, patternBindingId),
 * il est ignoré. Implémenté via une seule requête bulk + filtrage en mémoire (pas de N+1).
 *
 * Performance : 2 requêtes DB au total (findMany existing + createMany) au lieu de 2N.
 */
export async function generateCalendarSlots(
  options: GenerateCalendarOptions & { dryRun?: boolean }
): Promise<GenerateCalendarResult> {
  const { accountIds, dateFrom, dateTo, dryRun = false } = options;

  // 1. Récupérer toutes les liaisons actives (PatternBinding). Chaque binding
  //    expose le planning du compte + référence la recette globale
  //    (PatternTemplate) qu'il applique. On résout les valeurs effectives
  //    (incluant les overrides per-account) au moment de matérialiser le slot.
  const bindings = await prisma.patternBinding.findMany({
    where: {
      isActive: true,
      ...(accountIds && accountIds.length > 0 ? { accountId: { in: accountIds } } : {}),
    },
    include: {
      patternTemplate: true,
    },
  });

  if (bindings.length === 0) {
    return { created: 0, skipped: 0 };
  }

  // Adapte la shape des bindings sur l'ancien contrat utilisé plus bas.
  // Les valeurs sont déjà résolues (binding override > template). On laisse
  // les champs avec les mêmes noms que l'ancien modèle pour ne pas casser la
  // suite — le bloc "targets" reste agnostique du nouveau modèle.
  const patterns = bindings
    .filter((b) => {
      // Une recette qui EXIGE une fiche (requiresEntityTypeId, ex-
      // requiresProperty) ne peut pas être auto-matérialisée en masse : un
      // slot généré n'a aucune fiche rattachable. On l'exclut de l'auto-gen
      // hebdo (cohérent avec le guard de createSlot) ; ces recettes passent
      // par la création unitaire (mission / AddSlotModal).
      if (b.patternTemplate.requiresEntityTypeId || b.patternTemplate.requiresProperty) {
        console.warn(
          `[calendarEngine] binding ${b.id} → recette « ${b.patternTemplate.label} » exige une fiche — skip auto-gen (non rattachable en lot)`,
        );
        return false;
      }
      return true;
    })
    .map((b) => ({
      id: b.id,
      accountId: b.accountId,
      label: patternLabel(b),
      source: b.patternTemplate.source,
      dayOfWeek: b.dayOfWeek,
      publishTime: b.publishTime,
      templateId: b.patternTemplate.templateId,
      defaultAssigneeMonteurId: b.defaultAssigneeMonteurId,
      defaultAssigneeCmId: b.defaultAssigneeCmId,
      defaultAssigneeVideasteId: b.defaultAssigneeVideasteId,
    }));

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
      // dayOfWeek vide = pattern manuel (template uniquement, pas d'auto-gen).
      // On log au warn pour surfacer un éventuel mauvais paramétrage admin
      // (pattern actif mais sans jour planifié = silencieusement ignoré).
      if (pattern.dayOfWeek.length === 0) {
        console.warn(
          `[calendarEngine] pattern ${pattern.id} has empty dayOfWeek — skipping (no auto-generated slots)`,
        );
        continue;
      }
      // Guard publishTime malformé : sans ce filtre, un pattern avec
      // publishTime="" / "9:00" / "abc" produirait `[NaN, NaN]` qui passe
      // dans setUTCHours et donne un Invalid Date — Prisma.createMany
      // crash alors et FAIT ÉCHOUER toute la run pour TOUS les comptes.
      // Mieux : skip ce pattern avec un warn, continue les autres.
      const [hours, minutes] = (pattern.publishTime ?? "").split(":").map(Number);
      if (
        !Number.isFinite(hours) ||
        !Number.isFinite(minutes) ||
        hours < 0 || hours > 23 ||
        minutes < 0 || minutes > 59
      ) {
        console.warn(
          `[calendarEngine] pattern ${pattern.id} has invalid publishTime "${pattern.publishTime}" — skipping`,
        );
        continue;
      }
      for (const dow of pattern.dayOfWeek) {
        const targetDate = new Date(weekMs);
        targetDate.setUTCDate(targetDate.getUTCDate() + (dow - 1));
        targetDate.setUTCHours(hours, minutes, 0, 0);

        // Skip si en dehors de la plage demandée (utile aux bords semaine partielle)
        if (targetDate < dateFrom || targetDate > dateTo) continue;

        targets.push({ pattern, scheduledAt: targetDate });
      }
    }
  }

  if (targets.length === 0) {
    return { created: 0, skipped: 0 };
  }

  // 3. Bulk fetch des slots existants pour ces bindings sur la plage.
  //    La clé d'idempotence est maintenant (accountId, scheduledAt,
  //    patternBindingId) — équivalent au triple précédent puisque le
  //    backfill P2 a injecté patternBindingId sur tous les slots historiques.
  const bindingIds = patterns.map((p) => p.id);
  const existing = await prisma.publicationSlot.findMany({
    where: {
      patternBindingId: { in: bindingIds },
      scheduledAt: { gte: dateFrom, lte: dateTo },
    },
    select: { accountId: true, scheduledAt: true, patternBindingId: true },
  });

  // Index : "accountId|scheduledAtISO|patternBindingId".
  const existingKeys = new Set(
    existing
      .filter((s) => s.scheduledAt != null)
      .map(
        (s) =>
          `${s.accountId}|${s.scheduledAt!.toISOString()}|${s.patternBindingId}`,
      ),
  );

  // 4. Filtrer les cibles qui n'existent pas encore
  const toCreate = targets.filter(({ pattern, scheduledAt }) => {
    const key = `${pattern.accountId}|${scheduledAt.toISOString()}|${pattern.id}`;
    return !existingKeys.has(key);
  });

  // 5. Bulk insert — skippé en mode dry-run (W4.9 : permet à l'UI d'afficher
  // un résumé avant confirmation).
  if (toCreate.length > 0 && !dryRun) {
    await prisma.publicationSlot.createMany({
      data: toCreate.map(({ pattern, scheduledAt }) => ({
        accountId: pattern.accountId,
        scheduledAt,
        patternBindingId: pattern.id,
        // Statut initial dérivé de la source (voir mapSourceToInitialStatus)
        // — garantit que le slot apparaît immédiatement dans la worklist du bon rôle.
        status: mapSourceToInitialStatus(pattern.source),
        templateId: pattern.templateId ?? null,
        assigneeMonteurId: pattern.defaultAssigneeMonteurId ?? null,
        assigneeCmId: pattern.defaultAssigneeCmId ?? null,
        assigneeVideasteId: pattern.defaultAssigneeVideasteId ?? null,
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
