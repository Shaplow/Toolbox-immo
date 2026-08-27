/**
 * Retry générique avec backoff, extrait de `lib/r2.ts` (où il était privé) pour
 * être réutilisé par les appels réseau fragiles du pipeline cover.
 *
 * Le label sert uniquement aux logs — il identifie l'opération dans le warning
 * émis à chaque tentative ratée.
 */

export const DEFAULT_RETRY_DELAYS_MS = [500, 1500, 3000];

export async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  retries: readonly number[] = DEFAULT_RETRY_DELAYS_MS,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries.length) {
        console.warn(`[retry/${label}] attempt ${attempt + 1} failed, retrying in ${retries[attempt]}ms:`, err);
        await new Promise((res) => setTimeout(res, retries[attempt]));
      }
    }
  }
  throw lastErr;
}

/**
 * Variante qui ne retente que les échecs jugés transitoires.
 * `isRetryable` reçoit l'erreur ; retourner `false` interrompt immédiatement.
 * Utile quand un 4xx doit échouer tout de suite alors qu'un timeout mérite un
 * second essai.
 */
export async function withRetryIf<T>(
  label: string,
  fn: () => Promise<T>,
  isRetryable: (err: unknown) => boolean,
  retries: readonly number[] = DEFAULT_RETRY_DELAYS_MS,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= retries.length || !isRetryable(err)) break;
      console.warn(`[retry/${label}] attempt ${attempt + 1} failed, retrying in ${retries[attempt]}ms:`, err);
      await new Promise((res) => setTimeout(res, retries[attempt]));
    }
  }
  throw lastErr;
}
