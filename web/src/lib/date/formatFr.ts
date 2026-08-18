/**
 * Formateurs de date FR avec fuseau figé Europe/Paris.
 *
 * Pourquoi un fuseau explicite : le runtime (Vercel/Node) est en UTC. Sans
 * `timeZone`, un formatage côté serveur rend l'heure UTC (mauvais jour/heure sur
 * la fiche), et côté client un composant SSR diverge de l'hydratation navigateur
 * (warning React + flash d'heure fausse). On fige donc Europe/Paris partout.
 *
 * Accepte une Date ou une ISO string (sérialisation Server → Client).
 */

const TZ = "Europe/Paris";

/** Fallback affiché pour une date null/undefined/invalide par les helpers ci-dessous. */
const INVALID_DATE_FALLBACK = "—";

function toDate(v: Date | string): Date {
  return typeof v === "string" ? new Date(v) : v;
}

/** Comme `toDate`, mais tolère null/undefined et une string non parsable (retourne null). */
function toValidDate(v: Date | string | null | undefined): Date | null {
  if (v == null) return null;
  const d = toDate(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** « 14:00 » */
export function timeFr(v: Date | string): string {
  return toDate(v).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  });
}

/** « 21 juil. 14:00 » */
export function shortDateTimeFr(v: Date | string): string {
  return toDate(v).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  });
}

/** « lundi 21 juillet 14:00 » */
export function longDateTimeFr(v: Date | string): string {
  return toDate(v).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  });
}

/**
 * « 21 juil. 2026 » — date courte avec année. Le cas d'usage le plus courant
 * (listes, cartes, timestamps « mis à jour le »). Accepte null/undefined/date
 * invalide (retourne « — ») pour coller aux call-sites qui reçoivent un champ
 * optionnel sans avoir à null-checker avant d'appeler.
 */
export function dateFr(v: Date | string | null | undefined): string {
  const d = toValidDate(v);
  if (!d) return INVALID_DATE_FALLBACK;
  return d.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: TZ,
  });
}

/** « lundi 21 juillet 2026 » — date longue avec année, sans heure. */
export function dateFrLong(v: Date | string | null | undefined): string {
  const d = toValidDate(v);
  if (!d) return INVALID_DATE_FALLBACK;
  return d.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: TZ,
  });
}

/** « 21 juil. » — date courte sans année (deltas récents, cartes compactes). */
export function shortDateFr(v: Date | string | null | undefined): string {
  const d = toValidDate(v);
  if (!d) return INVALID_DATE_FALLBACK;
  return d.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    timeZone: TZ,
  });
}

/**
 * « 03 juil. » — comme `shortDateFr` mais jour zero-paddé (alignement
 * tabulaire dans les listes `font-mono tabular-nums`).
 */
export function shortDatePaddedFr(v: Date | string | null | undefined): string {
  const d = toValidDate(v);
  if (!d) return INVALID_DATE_FALLBACK;
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    timeZone: TZ,
  });
}

/** « 21 juillet » — jour + mois long, sans année (bornes de semaine). */
export function dayMonthLongFr(v: Date | string | null | undefined): string {
  const d = toValidDate(v);
  if (!d) return INVALID_DATE_FALLBACK;
  return d.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    timeZone: TZ,
  });
}

/** « 18/08/2026 » — format numérique par défaut Intl fr-FR (jj/mm/aaaa). */
export function numericDateFr(v: Date | string | null | undefined): string {
  const d = toValidDate(v);
  if (!d) return INVALID_DATE_FALLBACK;
  return d.toLocaleDateString("fr-FR", { timeZone: TZ });
}
