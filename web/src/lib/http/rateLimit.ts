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
  /** Nombre de clés suivies : observabilité, et seul moyen de tester la purge. */
  size(): number;
}

/**
 * Limiteur à fenêtre glissante : au plus `max` requêtes par `windowMs` et par
 * clé. La table ne dépasse JAMAIS `maxKeys` clés, pour qu'un balayage d'IP ne
 * fasse pas grossir la mémoire sans fin (les routes sont publiques : la clé est
 * insérée avant toute vérification de jeton).
 *
 * Quand une clé nouvelle arrive sur une table pleine :
 *  1. on purge les clés expirées, au plus UNE fois par fenêtre — le balayage est
 *     O(n), le refaire à chaque requête coûterait un temps quadratique sous
 *     rafale tant que la table reste pleine de clés actives ;
 *  2. s'il n'y a toujours pas de place, on évince les clés les moins récemment
 *     vues, une par une (O(1)). Une clé qui revient est replacée en fin de Map :
 *     l'ordre d'insertion est l'ordre de dernière activité, donc l'éviction ne
 *     retire jamais en premier l'IP qui martèle la route.
 *
 * Une clé évincée repart d'une fenêtre vierge : c'est le prix du plafond, et il
 * ne se paie que sous un balayage de plus de `maxKeys` IP distinctes.
 */
export function createRateLimiter(opts: {
  windowMs: number;
  max: number;
  maxKeys?: number;
}): RateLimiter {
  const { windowMs, max, maxKeys = 10_000 } = opts;
  const hits = new Map<string, number[]>();
  let lastPurgeAt = Number.NEGATIVE_INFINITY;

  function purgeExpired(now: number) {
    lastPurgeAt = now;
    const cutoff = now - windowMs;
    for (const [key, timestamps] of hits) {
      if (timestamps.length === 0 || timestamps[timestamps.length - 1] <= cutoff) {
        hits.delete(key);
      }
    }
  }

  /** Libère de la place pour UNE clé de plus. */
  function makeRoom(now: number) {
    if (now - lastPurgeAt >= windowMs) purgeExpired(now);
    let excess = hits.size - maxKeys + 1;
    for (const oldest of hits.keys()) {
      if (excess-- <= 0) break;
      hits.delete(oldest);
    }
  }

  return {
    check(key, now = Date.now()) {
      if (hits.size >= maxKeys && !hits.has(key)) makeRoom(now);

      const cutoff = now - windowMs;
      const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);
      const allowed = recent.length < max;
      if (allowed) recent.push(now);

      // delete + set : replace la clé en fin de Map (cf. éviction ci-dessus).
      // Une requête refusée compte aussi comme de l'activité.
      hits.delete(key);
      hits.set(key, recent);
      return allowed;
    },
    size: () => hits.size,
  };
}
