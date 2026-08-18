/**
 * « Cette recette exige-t-elle une fiche, et de quel type ? » — source de
 * vérité unique pour le fallback legacy `requiresProperty` → type « Bien ».
 *
 * `PatternTemplate.requiresEntityTypeId` (Phase 5 métaobjet) remplace le
 * booléen `requiresProperty`, mais la colonne legacy survit le temps du
 * backfill. La cascade `requiresEntityTypeId ?? (requiresProperty ? bien : null)`
 * était réimplémentée dans une dizaine de sites sous trois formes différentes
 * (page publication, fiche, MissionForm, AddSlotModal, slotService…). Passer
 * par ces helpers permet de supprimer le fallback en un seul endroit le jour
 * où `requiresProperty` est droppée du schéma.
 */

import { SYSTEM_ENTITY_TYPE_IDS } from "@/lib/entityTypes";

/** Forme minimale acceptée : n'importe quel objet portant les deux champs. */
export type EntityRequirementSource = {
  requiresEntityTypeId?: string | null;
  /** @deprecated Legacy — dérivé vers le type « Bien ». */
  requiresProperty?: boolean | null;
};

/** Id du type de fiche exigé par la recette, ou null si aucune fiche n'est requise. */
export function requiredEntityTypeId(
  pattern: EntityRequirementSource | null | undefined,
): string | null {
  if (!pattern) return null;
  return (
    pattern.requiresEntityTypeId ??
    (pattern.requiresProperty ? SYSTEM_ENTITY_TYPE_IDS.bien : null)
  );
}

/** `true` si la création d'un slot depuis cette recette exige une fiche. */
export function requiresEntity(pattern: EntityRequirementSource | null | undefined): boolean {
  return requiredEntityTypeId(pattern) !== null;
}
