/**
 * captureError — facade unifiée pour la remontée d'erreurs en production.
 *
 * Aujourd'hui : no-op + console.error (comportement actuel inchangé).
 * Demain : remplace l'implémentation par @sentry/nextjs sans toucher aux
 * call sites.
 *
 * Étapes pour activer Sentry quand l'équipe est prête (E1 du plan §19) :
 *  1. `npm install @sentry/nextjs`
 *  2. Ajouter SENTRY_DSN à .env.local (récupéré sur sentry.io)
 *  3. Créer sentry.client.config.ts + sentry.server.config.ts
 *     (commandes auto via `npx @sentry/wizard@latest -i nextjs`)
 *  4. Remplacer le corps de `captureError` et `captureMessage` par
 *     `Sentry.captureException` / `Sentry.captureMessage`.
 *
 * En attendant, les call sites sont en place et la migration sera
 * triviale (juste l'intérieur de ce fichier change).
 */

interface CaptureErrorContext {
  /** Tag fonctionnel pour catégoriser dans Sentry (ex. "runpod-submit", "comments-create"). */
  tag?: string;
  /** Données complémentaires (job IDs, user IDs, etc.). PII à éviter. */
  extra?: Record<string, unknown>;
  /** Niveau de sévérité — défaut "error". */
  level?: "error" | "warning" | "info";
}

/**
 * Capture une exception et la remonte vers l'outil d'observabilité.
 * No-op (console.error uniquement) tant que Sentry n'est pas câblé.
 */
export function captureError(error: unknown, context?: CaptureErrorContext): void {
  const tag = context?.tag ?? "uncategorized";
  const level = context?.level ?? "error";
  const msg = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  const logFn =
    level === "info" ? console.info : level === "warning" ? console.warn : console.error;

  logFn(`[captureError ${tag}]`, msg, {
    stack,
    ...context?.extra,
  });

  // TODO E1 step 4 : remplacer par Sentry.captureException(error, { tags: { tag }, extra: context.extra })
}

/**
 * Capture un message (sans exception associée). Utile pour signaler des
 * conditions anormales détectées (ex. "pack stalled > 30min", "RunPod
 * webhook callback unexpected status").
 */
export function captureMessage(message: string, context?: CaptureErrorContext): void {
  const tag = context?.tag ?? "uncategorized";
  const level = context?.level ?? "info";
  const logFn =
    level === "error" ? console.error : level === "warning" ? console.warn : console.info;
  logFn(`[captureMessage ${tag}]`, message, context?.extra ?? {});

  // TODO E1 step 4 : remplacer par Sentry.captureMessage(message, { level, tags: { tag } })
}
