/**
 * formValuesEqual — comparaison normalisée de deux jeux de valeurs de
 * formulaire, utilisée par la garde `beforeunload` de `ListingForm` (B.3, P6).
 *
 * Bug : `JSON.stringify(values) !== JSON.stringify(initialValues ?? {})`
 * comparait `values` (TOUJOURS une entrée par champ du schéma, vide ou non —
 * voir `resolveInitialFieldValue`) à `initialValues` (SEULEMENT les clés
 * pré-remplies côté serveur). Les deux objets n'ont quasiment jamais le même
 * jeu de clés → la garde restait armée en permanence, y compris sur un
 * formulaire fraîchement chargé sans aucune édition. Symptôme observé :
 * impossible de quitter la page alors que rien n'a été modifié.
 *
 * Fix : ignorer les clés absentes d'un des deux côtés et traiter
 * `undefined`/`null`/`""` comme équivalents (même règle que
 * `provenance.ts#isEmptyValue`) avant de comparer.
 */

import { isEmptyValue } from "@/lib/generate/provenance";

function normalizeForComparison(value: unknown): unknown {
  return isEmptyValue(value) ? "" : value;
}

/** `true` si deux valeurs de champ sont équivalentes une fois normalisées. */
function fieldValuesEqual(a: unknown, b: unknown): boolean {
  const na = normalizeForComparison(a);
  const nb = normalizeForComparison(b);
  if (na === nb) return true;
  if (typeof na === "object" || typeof nb === "object") {
    // Objets/tableaux (ex. focal point) — comparaison structurelle tolérante.
    try {
      return JSON.stringify(na) === JSON.stringify(nb);
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * `true` si `current` et `baseline` sont équivalents une fois les clés
 * absentes/vides normalisées — càd « rien qui vaille la peine d'avertir avant
 * de quitter » n'a changé.
 */
export function valuesEqualIgnoringEmpty(
  current: Record<string, unknown>,
  baseline: Record<string, unknown>,
): boolean {
  const keys = new Set([...Object.keys(current), ...Object.keys(baseline)]);
  for (const key of keys) {
    if (!fieldValuesEqual(current[key], baseline[key])) return false;
  }
  return true;
}
