/**
 * Raisons de non-génération d'un slot, et leur mise en français.
 *
 * Module PUR (aucun import Prisma) : `calendarEngine` le peuple côté serveur,
 * `CalendarView` le rend côté client. Sans ce découpage, le composant devrait
 * importer le moteur — et donc Prisma — pour juste afficher un libellé.
 */

export type CalendarSkipReason =
  | "no_active_bindings"
  | "requires_entity"
  | "empty_day_of_week"
  | "invalid_publish_time"
  | "out_of_range"
  | "already_exists";

export interface GenerateCalendarSkip {
  reason: CalendarSkipReason;
  bindingId?: string;
  accountHandle?: string;
  label?: string;
  /** Recettes concernées, ou dates écartées pour les raisons agrégées. */
  count: number;
}

/**
 * Ordre d'affichage : d'abord ce que l'admin peut corriger (paramétrage), puis
 * ce qui est normal (déjà créé). Un « 0 créé » doit mettre la cause actionnable
 * en tête, pas noyer l'admin sous l'idempotence.
 */
const REASON_ORDER: CalendarSkipReason[] = [
  "no_active_bindings",
  "empty_day_of_week",
  "invalid_publish_time",
  "requires_entity",
  "out_of_range",
  "already_exists",
];

/** Phrase par raison. `n` = recettes concernées (ou dates, cf. GenerateCalendarSkip). */
function describe(reason: CalendarSkipReason, n: number): string {
  const s = n > 1 ? "s" : "";
  switch (reason) {
    case "no_active_bindings":
      return "Aucune recette active sur ce périmètre — activez-en une sur la fiche du compte.";
    case "empty_day_of_week":
      return `${n} recette${s} active${s} sans jour planifié — renseignez le planning de la recette.`;
    case "invalid_publish_time":
      return `${n} recette${s} avec une heure de publication illisible — corrigez le format (HH:MM).`;
    case "requires_entity":
      return `${n} recette${s} exige${n > 1 ? "nt" : ""} une fiche — non générable${s} en lot, créez la publication depuis la fiche.`;
    case "out_of_range":
      return `${n} date${s} hors de la plage demandée (jour déjà passé ou bord de semaine).`;
    case "already_exists":
      return `${n} publication${s} existai${n > 1 ? "en" : ""}t déjà.`;
  }
}

export interface CalendarSkipSummaryLine {
  reason: CalendarSkipReason;
  text: string;
  /** Recettes nommées, pour que l'admin sache laquelle corriger. */
  details: string[];
}

/**
 * Agrège les skips par raison. Une recette invalide générait auparavant un skip
 * par semaine demandée : la déduplication se fait sur `bindingId` pour que
 * « 2 recettes sans jour » reste 2, même sur une génération de 4 semaines.
 */
export function summarizeCalendarSkips(
  skips: GenerateCalendarSkip[],
): CalendarSkipSummaryLine[] {
  const byReason = new Map<CalendarSkipReason, { total: number; seen: Set<string>; details: string[] }>();

  for (const skip of skips) {
    let entry = byReason.get(skip.reason);
    if (!entry) {
      entry = { total: 0, seen: new Set(), details: [] };
      byReason.set(skip.reason, entry);
    }
    // Les raisons par recette portent un bindingId ; les raisons agrégées
    // (out_of_range, already_exists) n'en ont pas et s'additionnent.
    if (skip.bindingId) {
      if (entry.seen.has(skip.bindingId)) continue;
      entry.seen.add(skip.bindingId);
      const name = skip.label ?? "recette sans nom";
      entry.details.push(skip.accountHandle ? `${name} (@${skip.accountHandle})` : name);
    }
    entry.total += skip.count;
  }

  return REASON_ORDER.filter((reason) => byReason.has(reason)).map((reason) => {
    const entry = byReason.get(reason)!;
    // `no_active_bindings` n'a rien à compter : le message se suffit.
    const n = entry.seen.size > 0 ? entry.seen.size : entry.total;
    return { reason, text: describe(reason, n), details: entry.details };
  });
}
