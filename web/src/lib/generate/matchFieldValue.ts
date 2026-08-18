/**
 * matchFieldValue — matching clé/valeur commun aux prefills du formulaire de
 * génération (DataEntry, fiche/tournage). Extrait de la boucle DataEntry de
 * `buildLibraryPrefillContext` (Phase 3, socle pré-remplissage) pour que les
 * DEUX chemins de pré-remplissage partagent la même règle plutôt que de
 * diverger silencieusement — c'est ce qui faisait qu'une clé de fiche « Prix »
 * ne remplissait pas un champ de template « prix ».
 *
 * Règles :
 *  - correspondance exacte sur `schemaField.key` d'abord ;
 *  - repli case-insensitive ensuite (via `buildLowerKeyMap`) ;
 *  - pour un champ `select` avec `options` statiques, la valeur trouvée est
 *    normalisée vers la casse canonique de l'option déclarée si elle matche
 *    (insensible à la casse).
 */

import type { SchemaField } from "@/types/template";
import { canOverride, isEmptyValue, type ValueProvenance } from "@/lib/generate/provenance";

/** Index clé-en-minuscule → valeur, pour le fallback case-insensitive. Ignore les valeurs vides. */
export function buildLowerKeyMap(
  source: Record<string, string | undefined | null>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value === null) continue;
    map.set(key.toLowerCase(), value);
  }
  return map;
}

/**
 * Résout la valeur de `schemaField` à partir de `source` (clés arbitraires,
 * ex. `DataEntry.fields` ou `Entity.fields`) : correspondance exacte, repli
 * case-insensitive via `lowerKeyMap` (calculé une fois par appelant avec
 * `buildLowerKeyMap`, pour éviter de le reconstruire à chaque champ dans une
 * boucle sur le schéma). Retourne `undefined` si aucune correspondance.
 */
export function matchFieldValue(
  schemaField: SchemaField,
  source: Record<string, string | undefined | null>,
  lowerKeyMap: Map<string, string>,
): string | undefined {
  const direct = source[schemaField.key];
  let value = direct !== undefined && direct !== null ? direct : lowerKeyMap.get(schemaField.key.toLowerCase());
  if (value === undefined) return undefined;

  if (
    schemaField.type === "select" &&
    Array.isArray(schemaField.options) &&
    schemaField.options.length > 0
  ) {
    const matched = schemaField.options.find((opt) => opt.toLowerCase() === value!.toLowerCase());
    if (matched) value = matched;
  }

  return value;
}

/**
 * Garde d'écrasement partagée par les prefills : une valeur déjà présente
 * n'est écrasée par `candidateProvenance` que si `canOverride` l'autorise.
 * Cas legacy conservateur : une valeur non vide sans provenance enregistrée
 * (ex. `ig_account`, posé hors du système de provenance) n'est jamais
 * écrasée — c'est le comportement historique d'avant l'introduction de la
 * provenance, qu'on ne veut pas régresser silencieusement.
 */
export function canAssignFieldValue(
  existingValue: unknown,
  currentProvenance: ValueProvenance | undefined,
  candidateProvenance: ValueProvenance,
): boolean {
  if (isEmptyValue(existingValue)) return true;
  if (currentProvenance === undefined) return false;
  return canOverride(currentProvenance, candidateProvenance);
}
