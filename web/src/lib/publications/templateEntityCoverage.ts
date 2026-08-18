/**
 * templateEntityCoverage — diagnostic « ce champ du template sera-t-il
 * alimenté par le type de fiche exigé par la recette ? ».
 *
 * Le lien recette → fiche repose sur deux mécanismes distincts (cf.
 * `lib/renderer/enrichListingWithEntityFields.ts`) :
 *   1. `SchemaField.entitySource` déclaré explicitement dans le builder
 *      (`lib/generate/provenance.ts` / `types/template.ts`) — résolu par
 *      accès DIRECT à la clé (`entityFields[entitySource.fieldKey]`),
 *      AUCUN repli casse-insensible.
 *   2. À défaut, une coïncidence implicite de nom de clé — même règle que
 *      `buildSlotPrefill` (`matchFieldValue` : exact, puis repli
 *      case-insensitive, cf. `lib/generate/matchFieldValue.ts`).
 *
 * Un admin qui configure une recette n'a aujourd'hui aucun moyen de savoir
 * si ces deux mécanismes matchent RÉELLEMENT sans lire le code — ce module
 * rejoue exactement les mêmes règles pour que le diagnostic dise la vérité,
 * jamais une approximation optimiste.
 */

import type { SchemaField } from "@/types/template";
import { buildLowerKeyMap, matchFieldValue } from "@/lib/generate/matchFieldValue";

export type TemplateFieldCoverageStatus =
  /** entitySource déclaré (slot "data"), clé trouvée dans la fiche exigée. */
  | "entitySource"
  /** Pas d'entitySource — correspondance implicite par nom de clé (matchFieldValue). */
  | "keyMatch"
  /** entitySource déclaré vers la fiche TOURNAGE — hors scope de ce diagnostic
   *  (alimenté par une autre fiche que celle exigée), listé pour ne rien cacher. */
  | "shootEntitySource"
  /** Aucune des règles ci-dessus ne matche — restera vide sans saisie manuelle. */
  | "uncovered";

export interface TemplateFieldCoverage {
  key: string;
  label: string;
  status: TemplateFieldCoverageStatus;
}

export interface EntityFieldKeyOption {
  key: string;
  label: string;
}

/**
 * Croise `templateSchema` (champs du template builder) avec
 * `entityFieldKeys` (clés du `fieldSchema` du type de fiche exigé par la
 * recette) et retourne, pour CHAQUE champ du template, la façon dont il
 * serait réellement alimenté.
 *
 * Diagnostic au niveau RECETTE (pas d'une fiche précise) : on synthétise une
 * valeur non vide par clé de fiche pour que `matchFieldValue` applique sa
 * vraie règle de correspondance sans avoir besoin d'une instance de fiche.
 */
export function computeTemplateEntityCoverage(
  templateSchema: SchemaField[],
  entityFieldKeys: EntityFieldKeyOption[],
): TemplateFieldCoverage[] {
  const entityKeySet = new Set(entityFieldKeys.map((f) => f.key));
  const placeholderSource: Record<string, string> = {};
  for (const f of entityFieldKeys) placeholderSource[f.key] = f.key;
  const lowerKeyMap = buildLowerKeyMap(placeholderSource);

  return templateSchema.map((field): TemplateFieldCoverage => {
    if (field.entitySource?.slot === "data") {
      return {
        key: field.key,
        label: field.label,
        status: entityKeySet.has(field.entitySource.fieldKey) ? "entitySource" : "uncovered",
      };
    }
    if (field.entitySource?.slot === "shoot") {
      return { key: field.key, label: field.label, status: "shootEntitySource" };
    }
    const matched = matchFieldValue(field, placeholderSource, lowerKeyMap) !== undefined;
    return { key: field.key, label: field.label, status: matched ? "keyMatch" : "uncovered" };
  });
}
