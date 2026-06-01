/**
 * captureError — facade unifiée pour la remontée d'erreurs en production.
 *
 * État actuel (2026-06-01) :
 *  - SENTRY_DSN env absent → no-op + console.error (comportement actuel)
 *  - SENTRY_DSN env présent → dynamic import @sentry/nextjs et delegate
 *  - Rate-limit interne : 1 envoi / min / tag pour éviter quota explosion
 *
 * Étapes pour activer Sentry quand l'équipe est prête :
 *  1. `npm install @sentry/nextjs`
 *  2. `npx @sentry/wizard@latest -i nextjs` (crée sentry.client/server/edge.config.ts + next.config wrap)
 *  3. Ajouter SENTRY_DSN à .env (récupéré sur sentry.io)
 *  4. Audit PII : ne pas envoyer slot.description, user.email, transcript brut dans `extra`
 *  5. Région EU + retention 30j minimum
 *
 * En attendant, les call sites sont en place et la migration sera transparente.
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
 * Rate-limit interne : 1 envoi / RATE_WINDOW_MS / tag.
 * Évite qu'un cron en boucle explose le quota Sentry (ou les logs prod).
 * In-memory Map → reset au cold-start, KO en multi-worker mais le worst-case
 * reste linéaire (N workers × 60 evts/h/tag).
 */
const RATE_WINDOW_MS = 60_000;
const lastSentByTag = new Map<string, number>();

function shouldEmit(tag: string): boolean {
  const now = Date.now();
  const last = lastSentByTag.get(tag) ?? 0;
  if (now - last < RATE_WINDOW_MS) return false;
  lastSentByTag.set(tag, now);
  return true;
}

/**
 * Capture une exception et la remonte vers l'outil d'observabilité.
 * No-op (console.error uniquement) tant que SENTRY_DSN n'est pas défini.
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

  // Si DSN configuré, delegate à Sentry (rate-limité pour ne pas exploser quota).
  // Dynamic import : la dep @sentry/nextjs n'est ajoutée que si l'équipe l'install.
  // Sans dep installée, l'import lance une erreur catchée silencieusement.
  if (process.env.SENTRY_DSN && shouldEmit(tag)) {
    // Dynamic import via variable pour bypass TS module check (dep optionnelle
    // pas encore installée). Si @sentry/nextjs absent, l'import throw et le
    // catch silencieux laisse le console.error standard prendre le relais.
    const sentryModule = "@sentry/nextjs";
    void import(/* webpackIgnore: true */ sentryModule)
      .then((Sentry: { captureException: (e: unknown, o: object) => void }) => {
        Sentry.captureException(error, {
          tags: { tag },
          level: level === "warning" ? "warning" : level === "info" ? "info" : "error",
          extra: context?.extra,
        });
      })
      .catch(() => {
        // @sentry/nextjs non installée ou DSN invalide → silencieux.
        // L'erreur a déjà été logguée via console.error/warn/info ci-dessus.
      });
  }
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

  if (process.env.SENTRY_DSN && shouldEmit(tag)) {
    const sentryModule = "@sentry/nextjs";
    void import(/* webpackIgnore: true */ sentryModule)
      .then((Sentry: { captureMessage: (m: string, o: object) => void }) => {
        Sentry.captureMessage(message, {
          tags: { tag },
          level: level === "warning" ? "warning" : level === "error" ? "error" : "info",
          extra: context?.extra,
        });
      })
      .catch(() => {
        // Cf. note dans captureError.
      });
  }
}
