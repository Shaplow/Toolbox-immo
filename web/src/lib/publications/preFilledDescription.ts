/**
 * preFilledDescription — résolution PURE (pas d'accès DB) de la légende
 * Instagram pré-remplie par une recette, en mode `needsDescription =
 * "preFilled"` (canonique) ou `"fixed"` (legacy, lu à l'identique).
 *
 * Vague 3 phase 3 — `descriptionFixedText` devient le MODÈLE canonique : un
 * texte libre avec interpolation `{{clé}}` (+ blocs `{{#if}}`, cf.
 * `lib/textTemplate.ts`) résolu contre les champs de la fiche rattachée
 * (fiche tournage < fiche data, même précédence que le pré-remplissage de
 * génération — cf. `lib/generate/provenance.ts`), puis les tokens système
 * (`{{maintenant}}`, cf. `lib/systemTokens.ts`).
 *
 * `descriptionSourceFieldKey` reste un ALIAS legacy en LECTURE (données
 * pré-migration — équivalent à un template `{{clé}}` littéral, résolu comme
 * avant) : plus aucune surface d'écriture ne le produit (cf.
 * `components/admin/shared/PatternTemplateFields.tsx`), mais il n'est ni
 * migré ni droppé dans ce lot.
 *
 * Règles strictes :
 *   - mode ∉ {"preFilled", "fixed"} → null (feature inactive)
 *   - résultat vide/blanc après résolution → null (on ne wipe JAMAIS la
 *     légende avec du vide — décision produit « toujours écraser au
 *     changement de fiche, mais seulement avec une valeur non vide »).
 */

import {
  extractConditionFields,
  extractTemplateVars,
  resolveTextTemplate,
} from "@/lib/textTemplate";
import { resolveSystemTokens } from "@/lib/systemTokens";
import { isEmptyValue } from "@/lib/generate/provenance";
import type { ListingData } from "@/types/listing";

/**
 * Normalise la clé source saisie côté recette : trim, chaîne vide → null.
 * Conservé pour les routes qui persistent encore `descriptionSourceFieldKey`
 * en lecture seule (legacy) — cf. `lib/services/pattern/patternTemplateInput.ts`.
 */
export function normalizeSourceFieldKey(
  raw: string | null | undefined,
): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Normalise le texte fixe/modèle saisi côté recette : non-string ou chaîne
 * vide/espaces → null. Conserve le brut (comme `normalizeSourceFieldKey`)
 * pour ne pas altérer un texte volontairement indenté.
 */
export function normalizeFixedText(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  return raw.trim().length > 0 ? raw : null;
}

export interface PrefilledCaptionConfig {
  needsDescription: string | null | undefined;
  descriptionFixedText: string | null | undefined;
  descriptionSourceFieldKey: string | null | undefined;
}

/**
 * Résout la légende pré-remplie d'un slot.
 *
 * @param config           needsDescription effectif + modèle/clé de la recette.
 * @param mergedFieldsJson Champs de fiche déjà mergés (fiche tournage < fiche
 *   data) — JSON `string` ou objet déjà parsé. `null`/`undefined` si aucune
 *   fiche n'est rattachée (un modèle sans `{{clé}}` reste résolvable quand
 *   même — il n'a besoin d'aucun champ).
 */
export function resolvePrefilledCaption(
  config: PrefilledCaptionConfig,
  mergedFieldsJson: string | Record<string, unknown> | null | undefined,
): string | null {
  if (config.needsDescription !== "preFilled" && config.needsDescription !== "fixed") {
    return null;
  }

  const template =
    typeof config.descriptionFixedText === "string" ? config.descriptionFixedText : "";
  if (template.trim().length > 0) {
    const fields = parseFields(mergedFieldsJson) ?? {};
    const resolved = resolveSystemTokens(
      resolveTextTemplate(template, fields as unknown as ListingData),
    );
    return resolved.trim().length > 0 ? resolved : null;
  }

  // Alias legacy : descriptionSourceFieldKey ≈ template `{{clé}}` littéral —
  // lookup direct plutôt que templating, comportement historique conservé à
  // l'identique pour ne pas re-formater une valeur déjà en DB.
  const key = config.descriptionSourceFieldKey?.trim();
  if (!key) return null;

  const fields = parseFields(mergedFieldsJson);
  if (!fields) return null;

  const raw = fields[key];
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value.length > 0 ? raw : null;
}

/** Parse tolérant d'une colonne `fields` (JSON `Record<string,string>`). */
function parseFields(
  input: string | Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (input == null) return null;
  if (typeof input === "object") {
    return Array.isArray(input) ? null : input;
  }
  try {
    const parsed = JSON.parse(input);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Clés du modèle de légende : `{{clé}}` + champs des conditions
 * `{{#if champ == "x"}}` + alias legacy `descriptionSourceFieldKey` quand le
 * modèle est vide — ce dernier compte alors comme LA variable du modèle
 * (lookup direct, cf. `resolvePrefilledCaption`).
 *
 * Vit ici et non dans `captionDataLibrary` : la garde anti-gaspillage de la
 * bibliothèque ET le diagnostic ci-dessous ont besoin de la même liste, et
 * deux définitions divergeraient.
 */
export function referencedTemplateKeys(config: PrefilledCaptionConfig): Set<string> {
  const template =
    typeof config.descriptionFixedText === "string" ? config.descriptionFixedText : "";
  if (template.trim().length > 0) {
    const keys = new Set(extractTemplateVars(template));
    for (const cond of extractConditionFields(template)) keys.add(cond.field);
    return keys;
  }
  const legacyKey = config.descriptionSourceFieldKey?.trim();
  return legacyKey ? new Set([legacyKey]) : new Set();
}

/**
 * Pourquoi une légende ne s'est pas résolue.
 *
 * Existe parce que l'échec était jusqu'ici attribué en bloc à la bibliothèque
 * de données (« bibliothèque vide, épuisée ou rotation désactivée »), y compris
 * quand aucune bibliothèque n'était configurée. La cause réelle est presque
 * toujours une clé absente — silencieuse, puisque `textTemplate` rend une
 * chaîne vide pour une variable inconnue.
 */
export type PrefilledCaptionFailure =
  | { reason: "mode_off" }
  | { reason: "no_template" }
  | { reason: "unresolved_keys"; keys: string[] }
  | { reason: "blank_result" };

/** `null` = la légende se résout. Sinon, la raison exacte. */
export function diagnosePrefilledCaption(
  config: PrefilledCaptionConfig,
  merged: Record<string, unknown>,
): PrefilledCaptionFailure | null {
  const mode = config.needsDescription;
  if (mode !== "preFilled" && mode !== "fixed") return { reason: "mode_off" };

  const keys = [...referencedTemplateKeys(config)];
  const hasTemplate =
    typeof config.descriptionFixedText === "string" &&
    config.descriptionFixedText.trim().length > 0;
  if (!hasTemplate && keys.length === 0) return { reason: "no_template" };

  if (resolvePrefilledCaption(config, merged) !== null) return null;

  const unresolved = keys.filter((key) => isEmptyValue(merged[key]));
  // Toutes les clés résolvent mais le rendu est blanc : le modèle lui-même ne
  // produit rien (conditions toutes fausses, texte réduit à des espaces).
  return unresolved.length > 0
    ? { reason: "unresolved_keys", keys: unresolved }
    : { reason: "blank_result" };
}

/** Clés du modèle restées sans valeur, même quand la légende se résout. */
export function unresolvedTemplateKeys(
  config: PrefilledCaptionConfig,
  merged: Record<string, unknown>,
): string[] {
  return [...referencedTemplateKeys(config)].filter((key) => isEmptyValue(merged[key]));
}

type FieldSource = string | Record<string, unknown> | null | undefined;

/**
 * Les quatre sources de champs d'une légende, de la plus spécifique à la plus
 * générique. L'ordre des propriétés ci-dessous EST l'ordre de précédence.
 */
export interface PrefilledCaptionSources {
  /** Fiche data rattachée à la publication (`slot.entityId`). */
  entityFields?: FieldSource;
  /** Fiche tournage (`slot.shootEntityId`). */
  shootEntityFields?: FieldSource;
  /**
   * Bien lié AU TOURNAGE (`shootEntity.relatedEntityId`).
   *
   * Sans cette source, le bien n'était lisible que s'il avait été RECOPIÉ sur
   * `slot.entityId` à la création du reel. Un tournage qui gagnait son bien
   * après coup laissait la légende définitivement vide : rien ne repropageait,
   * et « Recalculer » relisait la même fiche absente.
   */
  shootRelatedFields?: FieldSource;
  /** Entrée de bibliothèque tirée (cf. `captionDataLibrary.ts`). */
  dataEntryFields?: FieldSource;
}

/**
 * Empile des couches de champs : la PREMIÈRE couche qui porte une valeur non
 * vide pour une clé gagne.
 *
 * Fill-only à tous les étages, et c'est un changement volontaire : les deux
 * premières couches se écrasaient auparavant par simple spread, si bien qu'un
 * bien portant `prix: ""` effaçait le `prix: "250 000 €"` du tournage et
 * rendait une légende vide. Une valeur vide n'est pas une valeur — même garde
 * que le pré-remplissage de génération (`lib/generate/provenance.ts`).
 */
function mergeFieldLayers(layers: FieldSource[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const layer of layers) {
    const fields = parseFields(layer);
    if (!fields) continue;
    for (const [key, value] of Object.entries(fields)) {
      if (isEmptyValue(merged[key])) merged[key] = value;
    }
  }
  return merged;
}

/**
 * Fusionne les sources de champs puis résout la légende — pure, aucun accès DB.
 * Extraite pour que la logique de (re)calcul soit partagée entre les call sites
 * qui la déclenchent (create, patch, rattachement de tournage,
 * `POST /api/publications/[id]/recompute-caption`) au lieu de réimplémenter la
 * fusion à chaque endroit.
 *
 * Précédence : fiche data > fiche tournage > bien du tournage > bibliothèque.
 * Le bien passe AVANT la bibliothèque : une donnée réelle sur le sujet prime
 * sur du texte de rotation générique.
 */
export function resolvePrefilledCaptionFromEntities(
  config: PrefilledCaptionConfig,
  sources: PrefilledCaptionSources,
): string | null {
  return resolvePrefilledCaption(config, mergeCaptionSources(sources));
}

/** Le merge seul — utile au diagnostic, qui doit inspecter les mêmes valeurs. */
export function mergeCaptionSources(
  sources: PrefilledCaptionSources,
): Record<string, unknown> {
  return mergeFieldLayers([
    sources.entityFields,
    sources.shootEntityFields,
    sources.shootRelatedFields,
    sources.dataEntryFields,
  ]);
}
