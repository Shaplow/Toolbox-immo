/**
 * preFilledDescription — résolution PURE (pas d'accès DB) de la légende
 * Instagram pré-remplie depuis un Bien (Property) en mode `needsDescription =
 * "preFilled"`.
 *
 * Contexte : la recette (PatternTemplate) désigne, via `descriptionSourceFieldKey`,
 * la clé d'un champ personnalisé du Bien (`Property.fields[key]`). Au rattachement
 * d'un bien à une mission, cette valeur pré-remplit `slot.description`.
 *
 * Règles strictes :
 *   - mode ≠ "preFilled" OU pas de clé configurée → null (feature inactive)
 *   - `property.fields` JSON illisible / clé absente / valeur vide → null
 *     (on ne wipe JAMAIS la légende avec du vide — cf. décision produit
 *     « toujours écraser au changement de bien, mais seulement avec une
 *     valeur non vide »).
 */

interface PreFilledConfig {
  needsDescription: string | null | undefined;
  descriptionSourceFieldKey: string | null | undefined;
}

/**
 * Normalise la clé source saisie côté recette : trim, chaîne vide → null.
 * Utilisé par toutes les routes qui persistent `descriptionSourceFieldKey`
 * pour éviter d'enregistrer des `""` qui court-circuiteraient le prefill.
 */
export function normalizeSourceFieldKey(
  raw: string | null | undefined,
): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Retourne le texte de légende à pré-remplir, ou null si aucun pré-remplissage
 * ne s'applique.
 *
 * @param config       needsDescription effectif + clé source (recette).
 * @param propertyFieldsJson  Colonne `Property.fields` (string JSON) ou objet déjà parsé.
 */
export function resolvePreFilledDescription(
  config: PreFilledConfig,
  propertyFieldsJson: string | Record<string, unknown> | null | undefined,
): string | null {
  if (config.needsDescription !== "preFilled") return null;
  const key = config.descriptionSourceFieldKey?.trim();
  if (!key) return null;

  const fields = parseFields(propertyFieldsJson);
  if (!fields) return null;

  const raw = fields[key];
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value.length > 0 ? raw : null;
}

/**
 * Normalise le texte fixe saisi côté recette (mode `needsDescription = "fixed"`) :
 * non-string ou chaîne vide/espaces → null. Conserve le brut (comme
 * `normalizeSourceFieldKey`) pour ne pas altérer un texte volontairement indenté.
 */
export function normalizeFixedText(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  return raw.trim().length > 0 ? raw : null;
}

interface FixedConfig {
  needsDescription: string | null | undefined;
  descriptionFixedText: string | null | undefined;
}

/**
 * Retourne le texte fixe à pré-remplir en mode `"fixed"`, ou null.
 *
 * Contrairement à `resolvePreFilledDescription`, aucune dépendance au Bien :
 * la source est un texte littéral stocké sur la recette (PatternTemplate).
 * Copie one-shot à la création du slot ; jamais re-synchronisée ensuite.
 */
export function resolveFixedDescription(config: FixedConfig): string | null {
  if (config.needsDescription !== "fixed") return null;
  const raw = config.descriptionFixedText;
  if (typeof raw !== "string") return null;
  return raw.trim().length > 0 ? raw : null;
}

/** Parse tolérant de la colonne `Property.fields` (JSON Record<string,string>). */
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
