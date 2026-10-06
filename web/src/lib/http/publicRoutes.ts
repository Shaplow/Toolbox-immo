/**
 * Routes accessibles sans session (consommé par `src/proxy.ts`).
 *
 * Le jeton de l'URL — ou le secret cron — EST l'authentification : chaque
 * handler le vérifie lui-même (hash en base, expiration, révocation, ou
 * comparaison timing-safe de CRON_SECRET). Le proxy se contente de ne pas
 * exiger de session sur ces chemins précis.
 *
 * Regex ancrées, un segment par jeton : ni sous-chemin (`/validate/a/b`), ni
 * préfixe voisin (`/exports-admin`). Module pur — `proxy.ts` importe NextAuth
 * et Prisma, il n'est pas testable tel quel.
 *
 * Avant le 06/10/2026, aucune de ces routes n'était déclarée : les liens
 * magiques renvoyaient vers /login et les crons répondaient 401 en prod.
 */
const PUBLIC_PATTERNS: readonly RegExp[] = [
  // Validation client par lien magique — lib/publications/clientValidation.ts
  /^\/validate\/[^/]+$/,
  /^\/api\/validate\/[^/]+$/,
  // Remplissage public d'une bibliothèque de données — DataLibrary.publicFillToken
  /^\/data-fill\/[^/]+$/,
  /^\/api\/data-fill\/[^/]+$/,
  // Crons — CRON_SECRET vérifié en temps constant dans chaque handler
  /^\/api\/cron\/(?:r2-cleanup|pod-reconcile|calendar)$/,
];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATTERNS.some((pattern) => pattern.test(pathname));
}
