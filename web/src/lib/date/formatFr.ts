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

/**
 * Fuseau de référence de l'app. Exporté pour les formats « bespoke » qui ne
 * passent pas par les helpers ci-dessous : sans `timeZone` explicite, Intl
 * retombe sur le fuseau du navigateur et l'écran diverge du reste de l'app.
 */
export const PARIS_TZ = "Europe/Paris";
const TZ = PARIS_TZ;

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

/**
 * Heure murale Europe/Paris d'un instant donné, en nombres.
 * `Intl` est la seule source fiable ici : il gère l'heure d'été sans table.
 */
const WALL_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function parisWall(d: Date) {
  const p: Record<string, string> = {};
  for (const { type, value } of WALL_PARTS.formatToParts(d)) p[type] = value;
  return {
    year: p.year,
    month: p.month,
    day: p.day,
    // `hour12: false` rend minuit « 24 » sur certains runtimes.
    hour: p.hour === "24" ? "00" : p.hour,
    minute: p.minute,
    second: p.second,
  };
}

/** Décalage Europe/Paris (ms) à l'instant `utcMs`. */
function parisOffsetMs(utcMs: number): number {
  const w = parisWall(new Date(utcMs));
  const asIfUTC = Date.UTC(
    Number(w.year),
    Number(w.month) - 1,
    Number(w.day),
    Number(w.hour),
    Number(w.minute),
    Number(w.second),
  );
  return asIfUTC - utcMs;
}

/**
 * ISO (UTC) → valeur "YYYY-MM-DDTHH:MM" pour un DateTimeField, en heure
 * **Europe/Paris** — le même fuseau que tous les formateurs ci-dessous.
 *
 * Le fuseau du navigateur ne doit surtout pas entrer en jeu : sinon la valeur
 * saisie et la valeur relue divergent dès que le poste n'est pas réglé sur
 * Paris (déplacement, machine mal réglée, client à l'étranger), sans le
 * moindre signal à l'écran.
 */
export function isoToLocalInput(iso: string): string {
  const d = toValidDate(iso);
  if (!d) return "";
  const w = parisWall(d);
  return `${w.year}-${w.month}-${w.day}T${w.hour}:${w.minute}`;
}

/**
 * Réciproque de `isoToLocalInput` : "YYYY-MM-DDTHH:MM" lu comme heure murale
 * Europe/Paris → instant ISO (UTC). Remplace `new Date(value).toISOString()`,
 * qui interprétait la chaîne dans le fuseau du navigateur.
 *
 * Deux passes pour le changement d'heure : le décalage dépend de l'instant,
 * qu'on ne connaît qu'après l'avoir appliqué une première fois.
 */
export function localInputToIso(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!m) return null;
  const wallAsUTC = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  let utc = wallAsUTC - parisOffsetMs(wallAsUTC);
  utc = wallAsUTC - parisOffsetMs(utc);
  const d = new Date(utc);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Une valeur de DateTimeField ("YYYY-MM-DDTHH:MM") est-elle déjà passée ?
 * Sert à prévenir plutôt qu'à bloquer : une date passée reste un choix
 * légitime (saisie a posteriori), mais elle fait disparaître la fiche des vues
 * planning qui s'ouvrent sur la semaine courante.
 */
export function isPastLocalInput(local: string): boolean {
  const iso = localInputToIso(local);
  return iso !== null && new Date(iso).getTime() < Date.now();
}

/**
 * Jour civil ("YYYY-MM-DD") d'un instant, à Paris.
 *
 * À comparer aux cases d'une grille calendrier, qui sont des jours civils et
 * non des instants : les composantes locales d'une `Date` rangeraient une
 * publication de 21:00 Paris dans la colonne du lendemain pour un poste en
 * avance sur Paris.
 */
export function parisDayKey(v: Date | string | null | undefined): string {
  const d = toValidDate(v);
  if (!d) return "";
  const w = parisWall(d);
  return `${w.year}-${w.month}-${w.day}`;
}

/**
 * Jour civil courant à Paris, sous forme de Date « murale » (minuit dans le
 * fuseau du navigateur). Pour les composants calendrier, qui raisonnent en
 * jours et non en instants : sans ça, « aujourd'hui » se surligne sur le
 * mauvais jour dès que le fuseau du poste a basculé avant ou après Paris.
 */
export function parisToday(): Date {
  const w = parisWall(new Date());
  return new Date(Number(w.year), Number(w.month) - 1, Number(w.day));
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
