/**
 * Limitation de débit des routes publiques (liens tokenisés).
 *
 * En mémoire : la prod tourne sur un seul process PM2, ça suffit. Les compteurs
 * repartent à zéro à chaque redémarrage — acceptable, les jetons font 256 bits
 * et le limiteur ne sert qu'à freiner un script.
 */

/**
 * IP du client derrière nginx.
 *
 * nginx pose `X-Real-IP $remote_addr` (fiable) et
 * `X-Forwarded-For $proxy_add_x_forwarded_for`, qui AJOUTE l'adresse vue à la
 * fin de ce que le client a envoyé : le premier élément de X-Forwarded-For est
 * donc choisi par le client et ne doit jamais servir de clé de limitation.
 * Repli sur le dernier élément (posé par nginx), puis "unknown".
 */
export function getClientIp(req: Request): string {
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded
      .split(",")
      .map((hop) => hop.trim())
      .filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return "unknown";
}

export interface RateLimiter {
  /** true si la requête passe, false si la clé a épuisé sa fenêtre. */
  check(key: string, now?: number): boolean;
}

/**
 * Limiteur à fenêtre glissante : au plus `max` requêtes par `windowMs` et par
 * clé. Les clés inactives sont purgées dès que la table dépasse `maxKeys`, pour
 * qu'un balayage d'IP ne fasse pas grossir la mémoire sans fin.
 */
export function createRateLimiter(opts: {
  windowMs: number;
  max: number;
  maxKeys?: number;
}): RateLimiter {
  const { windowMs, max, maxKeys = 10_000 } = opts;
  const hits = new Map<string, number[]>();

  function purge(now: number) {
    const cutoff = now - windowMs;
    for (const [key, timestamps] of hits) {
      if (timestamps.length === 0 || timestamps[timestamps.length - 1] <= cutoff) {
        hits.delete(key);
      }
    }
  }

  return {
    check(key, now = Date.now()) {
      if (hits.size > maxKeys) purge(now);
      const cutoff = now - windowMs;
      const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);
      if (recent.length >= max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      return true;
    },
  };
}
