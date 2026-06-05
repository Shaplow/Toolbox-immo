/**
 * Parse JSON tolérant — utilise le fallback si la chaîne est null/undefined
 * ou JSON invalide. Évite de jeter une exception sur du legacy data.
 *
 * Auparavant dupliqué dans 2 fichiers (slotService.ts + publications/[id]/route.ts)
 * avec implémentations identiques. Le centraliser supprime le risque de drift
 * (ex: ajout d'un log côté slot oublié côté route).
 */
export function safeJSON<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}
