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

import { resolveTextTemplate } from "@/lib/textTemplate";
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
 * Fusionne les champs bruts de la fiche tournage et de la fiche data (même
 * précédence que `createSlot`/`patchSlot` : fiche tournage < fiche data) puis
 * résout la légende — pure, aucun accès DB. Extrait pour que la logique de
 * (re)calcul soit partagée entre les call sites qui la déclenchent (create,
 * patch au rattachement, `POST /api/publications/[id]/recompute-caption`)
 * au lieu de réimplémenter la fusion à chaque endroit.
 *
 * @param dataEntryFieldsJson Champs d'une DataEntry tirée (cf.
 *   `lib/publications/captionDataLibrary.ts`), 4e source OPTIONNELLE.
 *   Fusion **fill-only** (pas un spread) : une clé de l'entrée ne comble que
 *   les trous du merge fiche tournage/fiche data — jamais elle n'écrase une
 *   valeur déjà présente, y compris une valeur vide (`""`) volontairement
 *   laissée par une fiche (cf. `canAssignFieldValue` /
 *   `lib/generate/provenance.ts`, même garde que le pré-remplissage de
 *   génération). Précédence résultante : entity > shootEntity > dataEntry.
 */
export function resolvePrefilledCaptionFromEntities(
  config: PrefilledCaptionConfig,
  shootEntityFieldsJson: string | Record<string, unknown> | null | undefined,
  entityFieldsJson: string | Record<string, unknown> | null | undefined,
  dataEntryFieldsJson?: string | Record<string, unknown> | null,
): string | null {
  const mergedFields: Record<string, unknown> = {
    ...(parseFields(shootEntityFieldsJson) ?? {}),
    ...(parseFields(entityFieldsJson) ?? {}),
  };
  const dataFields = parseFields(dataEntryFieldsJson);
  if (dataFields) {
    for (const [key, value] of Object.entries(dataFields)) {
      if (isEmptyValue(mergedFields[key])) {
        mergedFields[key] = value;
      }
    }
  }
  return resolvePrefilledCaption(config, mergedFields);
}
