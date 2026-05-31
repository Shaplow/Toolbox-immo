/**
 * Helpers pour valider des URLs/paths reçus via query params (returnTo, etc.)
 * sans exposer à des open-redirect ou des injections.
 *
 * Centralisé Phase V2 — avant, `isSafeRelativePath` était dupliqué dans
 * DescriptionTool, validé "lite" dans CaptionsGallery (juste startsWith),
 * et inexistant dans /transcriptions. Source de divergence progressive.
 */

/**
 * Returns true si `raw` est un path relatif sûr, utilisable comme `href`
 * de redirection après usage d'un tool (returnTo).
 *
 * Rejette : URLs absolues, schemes, traversées (..), espaces, caractères
 * non-ASCII non-URL-encodés, séquences //.* et /\.* (protocol-relative).
 */
export function isSafeRelativePath(raw: string): boolean {
  if (!raw.startsWith("/")) return false;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return false;
  if (/\s/.test(raw)) return false;
  // Décode pour détecter les traversées encodées (%2e%2e, etc.).
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return false;
  }
  if (decoded.includes("..")) return false;
  if (decoded.startsWith("//") || decoded.startsWith("/\\")) return false;
  // Seuls les caractères path/query/hash sûrs.
  return /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@/?#%]*$/.test(raw);
}
