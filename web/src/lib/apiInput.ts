/**
 * Normalisation des entrées API faiblement typées.
 *
 * Contexte (bug rotation, 30/05 → 12/08) : `MediaLibrarySettingsDrawer` envoyait
 * `tags` et `setSequence` déjà sérialisés (`JSON.stringify([...])`) alors que la
 * route PATCH ne les acceptait qu'en tableau via `Array.isArray(...)`. La
 * condition était donc toujours fausse : la route répondait 200, l'UI affichait
 * « enregistré », et les deux champs n'étaient jamais écrits. Passer une
 * bibliothèque en mode « Auto » ne vidait donc jamais sa `setSequence`.
 *
 * Deux leçons encodées ici :
 *  - on accepte les deux formes (tableau ou string JSON) pour rester compatible
 *    avec un client déployé ;
 *  - on REJETTE explicitement tout le reste au lieu de l'ignorer. Un champ
 *    silencieusement jeté est indétectable côté client.
 */

export type StringArrayInputResult =
  | { ok: true; value: string[] | undefined }
  | { ok: false; error: string };

/**
 * Normalise une valeur censée représenter un `string[]`.
 *
 * @param value     La valeur brute reçue dans le body.
 * @param fieldName Nom du champ, utilisé dans le message d'erreur.
 * @returns `value: undefined` quand le champ est absent (pas de mise à jour),
 *          sinon le tableau normalisé. `ok: false` si la valeur est présente
 *          mais inexploitable — l'appelant doit répondre 400.
 */
export function normalizeStringArrayInput(
  value: unknown,
  fieldName: string,
): StringArrayInputResult {
  if (value === undefined || value === null) return { ok: true, value: undefined };

  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === "string")) {
      return { ok: true, value: value as string[] };
    }
    return { ok: false, error: `${fieldName} doit être un tableau de chaînes` };
  }

  if (typeof value === "string") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      return { ok: false, error: `${fieldName} doit être un tableau ou une chaîne JSON valide` };
    }
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) {
      return { ok: true, value: parsed as string[] };
    }
    return { ok: false, error: `${fieldName} doit être un tableau de chaînes` };
  }

  return { ok: false, error: `${fieldName} doit être un tableau de chaînes` };
}
