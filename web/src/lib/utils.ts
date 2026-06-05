import { timingSafeEqual as cryptoTimingSafeEqual } from "crypto";

export function nanoid(length = 8): string {
  return Math.random().toString(36).slice(2, 2 + length);
}

/**
 * Compare deux strings (secret + valeur fournie) en temps constant pour éviter
 * les attaques par timing side-channel.
 *
 * `crypto.timingSafeEqual` exige des buffers de même longueur — sinon il throw,
 * ce qui réintroduit un side-channel sur la longueur. On normalise via un check
 * de longueur préalable (qui fuit la longueur, mais pas le contenu — acceptable
 * pour les secrets de taille fixe comme CRON_SECRET).
 */
export function timingSafeEqualStrings(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return cryptoTimingSafeEqual(bufA, bufB);
}
