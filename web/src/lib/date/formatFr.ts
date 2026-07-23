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

function toDate(v: Date | string): Date {
  return typeof v === "string" ? new Date(v) : v;
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
