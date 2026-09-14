/**
 * customFields — modèle CANONIQUE de « champ personnalisé » typé, partagé par :
 *   - Property (Bien), PublicationSlot/mission, PatternTemplate/recette
 *   - MediaLibrary.metadataSchema, DataLibrary.fieldsSchema
 *
 * Remplace les 6 déclarations concurrentes (FieldDef / MetadataField / string[]).
 * 6 types : text / textarea / number / url / select (choix fermé via `options`)
 * / checkbox (case à cocher).
 *
 * Les valeurs restent stockées en STRING, checkbox compris (`"true"` = coché,
 * tout le reste = décoché, cf. CHECKBOX_TRUE / isCheckedFieldValue). Introduire
 * un booléen casserait `Entity.fields`, les métadonnées MediaAsset, DataEntry,
 * l'interpolation `{{clé}}` et tous les `.trim()` du repo pour un seul type de
 * champ. Le type pilote le rendu et l'édition, pas la coercition serveur.
 *
 * `CustomFieldType` n'est plus un sous-ensemble strict de `SchemaFieldType` :
 * `checkbox` s'y projette en `boolean` (cf. customFieldToSchemaField).
 */

import type { SchemaField } from "@/types/template";
import { validateSchemaFieldKey } from "@/lib/schemaFields";

export type CustomFieldType =
  | "text"
  | "textarea"
  | "number"
  | "url"
  | "select"
  | "checkbox";

/**
 * Valeur d'un `checkbox` coché. Tout le reste (`""`, absent) vaut décoché.
 * Exporté pour que personne ne réinvente la comparaison au fil des surfaces.
 */
export const CHECKBOX_TRUE = "true";

export function isCheckedFieldValue(value: string | undefined | null): boolean {
  return value === CHECKBOX_TRUE;
}

export interface CustomField {
  key: string;
  label: string;
  type: CustomFieldType;
  /**
   * Texte d'aide affiché sous le champ — le « pourquoi on demande ça » que le
   * libellé seul ne porte pas. Borné à MAX_DESCRIPTION : c'est une aide, pas
   * une notice.
   */
  description?: string;
  /**
   * Champ obligatoire. Sur un `checkbox`, signifie « doit être coché »
   * (comportement HTML natif et Tally) — décoché bloque l'enregistrement.
   */
  required?: boolean;
  /** Data spreadsheet : visible dans la vue table compacte. Extension optionnelle. */
  primary?: boolean;
  /** Choix fermé (`type === "select"` uniquement) : valeurs autorisées. */
  options?: string[];
}

export const CUSTOM_FIELD_TYPES: { value: CustomFieldType; label: string }[] = [
  { value: "text", label: "Texte" },
  { value: "textarea", label: "Texte long" },
  { value: "number", label: "Nombre" },
  { value: "url", label: "Lien URL" },
  { value: "select", label: "Choix fermé" },
  { value: "checkbox", label: "Case à cocher" },
];

const VALID_TYPES = new Set<CustomFieldType>([
  "text",
  "textarea",
  "number",
  "url",
  "select",
  "checkbox",
]);

/** Longueur max d'un texte d'aide — au-delà, ce n'est plus de l'aide. */
export const MAX_DESCRIPTION = 200;

/** Libellés qui suggèrent du texte multi-ligne (accent-insensible). */
const LONG_TEXT_LABEL = /desc|note|adresse|comment|resum|\bbio\b/i;

/**
 * Type par défaut suggéré pour un NOUVEAU champ d'après son libellé. Les champs
 * de texte long courants (description, notes, adresse, commentaire, résumé…) sont
 * créés en `textarea` — un input une ligne perd les retours à la ligne. Ce n'est
 * qu'un défaut : l'utilisateur peut toujours changer le type ensuite.
 */
export function inferDefaultFieldType(label: string): CustomFieldType {
  const normalized = label.normalize("NFD").replace(/[̀-ͯ]/g, "");
  return LONG_TEXT_LABEL.test(normalized) ? "textarea" : "text";
}

function coerceType(raw: unknown): CustomFieldType {
  return typeof raw === "string" && VALID_TYPES.has(raw as CustomFieldType)
    ? (raw as CustomFieldType)
    : "text";
}

/** Coerce une liste d'options de select : strings trimmed, non vides, dédupliquées. */
function coerceOptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const v = item.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/**
 * Normalise n'importe quelle représentation legacy en `CustomField[]` :
 *   - `string[]` (ancien fieldSchema plat)  → {key:s, label:s, type:"text"}
 *   - `{key,label,type,required?,primary?}[]` (media/data/nouveau) → tel quel (type coercé)
 * Tolère le JSON malformé (retourne []). À appeler à CHAQUE lecture d'un
 * fieldSchema/metadataSchema (pas de migration DB — rétro-compat au read).
 */
export function normalizeCustomFields(raw: unknown): CustomField[] {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];

  const out: CustomField[] = [];
  const seen = new Set<string>();
  for (const item of arr) {
    // Legacy plat : une string = un nom de champ.
    if (typeof item === "string") {
      const key = item.trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ key, label: key, type: "text" });
      continue;
    }
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const key = typeof o.key === "string" ? o.key.trim() : "";
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const label =
        typeof o.label === "string" && o.label.trim() ? o.label.trim() : key;
      const field: CustomField = { key, label, type: coerceType(o.type) };
      const description = typeof o.description === "string" ? o.description.trim() : "";
      if (description) field.description = description.slice(0, MAX_DESCRIPTION);
      if (o.required === true) field.required = true;
      if (o.primary === true) field.primary = true;
      if (field.type === "select") {
        field.options = coerceOptions(o.options);
      }
      out.push(field);
    }
  }
  return out;
}

/**
 * Convertit un champ perso en `SchemaField` pour la fusion dans le formulaire
 * de génération.
 *
 * Le mapping est l'identité PARTOUT SAUF pour `checkbox`, qui n'existe pas côté
 * SchemaFieldType et s'y projette en `boolean` — d'où le switch explicite
 * plutôt qu'un passage direct du type.
 *
 * `description` était jusqu'ici jetée alors que `SchemaField` la porte déjà.
 */
export function customFieldToSchemaField(f: CustomField): SchemaField {
  const field: SchemaField = {
    key: f.key,
    label: f.label || f.key,
    type: f.type === "checkbox" ? "boolean" : f.type,
    required: Boolean(f.required),
  };
  if (f.description) field.description = f.description;
  if (f.type === "select") field.options = f.options ?? [];
  return field;
}

/** Valide une liste de champs perso (clés valides + uniques). Retourne un message
 *  d'erreur ou null. Réutilise la validation de clé du kit SchemaField. */
export function validateCustomFields(fields: CustomField[]): string | null {
  const keys: string[] = [];
  for (const f of fields) {
    const err = validateSchemaFieldKey(f.key, keys);
    if (err) return `Champ « ${f.key || "?"} » : ${err}`;
    keys.push(f.key.trim());
    if (!f.label || !f.label.trim()) return `Champ « ${f.key} » : libellé requis`;
    if (f.type === "select" && (!f.options || f.options.length === 0)) {
      return `Champ « ${f.label} » : au moins une option est requise pour un choix fermé`;
    }
  }
  return null;
}

/**
 * Valide des VALEURS contre un schéma de champs perso. Retourne un message
 * d'erreur ou null. Validation au write uniquement (les valeurs historiques
 * non conformes restent lisibles).
 *
 * - `requireRequired` : exige les champs `required` non vides (création /
 *   soumission de formulaire). En édition partielle, laisser à false — un
 *   schéma modifié après coup ne doit pas bloquer la sauvegarde d'une fiche
 *   existante.
 * - `allowUnknownKeys` : tolère les clés hors schéma (édition d'une fiche
 *   dont le schéma a changé — clés orphelines affichées ailleurs). À false
 *   pour les créations et les écritures externes (whitelist stricte).
 * - Un select non vide doit appartenir aux options ; `""` est toléré quand le
 *   champ n'est pas requis (ou que `requireRequired` est false).
 * - Un champ `number` doit avoir un format numérique (cf. `isNumericFieldValue`).
 *   Les valeurs restent STOCKÉES en string — on valide la forme, on ne coerce
 *   pas : c'est le rendu qui décide du formatage.
 * - `previousValues` : valeurs actuellement EN BASE. Une valeur numérique
 *   invalide qui n'a pas changé est laissée passer. Sans ce garde-fou, durcir
 *   la règle rendrait insauvable toute fiche portant une valeur historique non
 *   conforme — quelqu'un qui corrige une faute de frappe dans un autre champ se
 *   verrait bloqué par une donnée qu'il n'a pas touchée. La tolérance est
 *   strictement confinée au type `number` : relâcher aussi les choix fermés
 *   ouvrirait le seul filtre de forme appliqué aux saisies d'un client externe.
 */
/**
 * Format accepté pour un champ `number` : entier ou décimal, virgule OU point,
 * signe négatif, séparateurs de milliers en espaces (y compris insécables).
 *
 * Volontairement STRICT, et volontairement PAS `toFlexibleNumber`
 * (`lib/numberFormatting`) : ce dernier est une coercition d'affichage, qui
 * retire tous les caractères non numériques — il rend 68 pour « 68 m² », 12
 * pour « abc12 » et 120150 pour « 120-150 ». Exactement les saisies qu'on
 * cherche à refuser ici.
 */
const NUMERIC_FIELD_VALUE = /^-?\d+(?:[.,]\d+)?$/;

/** Espaces, y compris fine et insécable, utilisés comme séparateurs de milliers. */
const THOUSANDS_SPACES = /[\s\u202F\u00A0]/g;

/** Valeur acceptable pour un champ de type `number`. */
export function isNumericFieldValue(value: string): boolean {
  return NUMERIC_FIELD_VALUE.test(value.trim().replace(THOUSANDS_SPACES, ""));
}

/**
 * Saisie EN COURS pour un champ `number` : tolère les états intermédiaires
 * qu'un utilisateur traverse forcément en tapant (« », « - », « 68, »).
 * Sert au filtre de frappe côté UI, pas à la validation d'un enregistrement.
 */
const PARTIAL_NUMERIC = /^-?[\d\s\u202F\u00A0]*(?:[.,]\d*)?$/;

export function isPartialNumericInput(value: string): boolean {
  return PARTIAL_NUMERIC.test(value);
}

export interface ValidateFieldValuesOptions {
  requireRequired?: boolean;
  allowUnknownKeys?: boolean;
  previousValues?: Record<string, string>;
}

/**
 * Valide les valeurs et retourne UNE erreur par clé fautive.
 *
 * Nécessaire à l'UI : un formulaire doit pouvoir signaler ses champs vides
 * TOUS EN MÊME TEMPS et dès l'ouverture, pas les découvrir un par un à chaque
 * tentative d'enregistrement. `validateFieldValues` (message unique) en est
 * dérivée, pour que la règle ne puisse pas diverger entre les deux.
 *
 * La clé spéciale `__unknown` porte l'erreur de clé hors schéma.
 */
export function validateFieldValuesAll(
  schema: CustomField[],
  values: Record<string, string>,
  opts: ValidateFieldValuesOptions = {}
): Record<string, string> {
  const errors: Record<string, string> = {};
  const byKey = new Map(schema.map((f) => [f.key, f]));

  if (!opts.allowUnknownKeys && schema.length > 0) {
    for (const key of Object.keys(values)) {
      if (!byKey.has(key)) {
        errors.__unknown = `Champ inconnu : « ${key} »`;
        break;
      }
    }
  }

  for (const field of schema) {
    const raw = values[field.key];
    const value = typeof raw === "string" ? raw.trim() : "";
    const name = field.label || field.key;

    if (opts.requireRequired && field.required && !isFieldFilled(field, value)) {
      // Un checkbox requis n'est pas « vide », il est décoché — et dire
      // « requis » sur une case laisse l'utilisateur chercher quoi remplir.
      errors[field.key] =
        field.type === "checkbox"
          ? `La case « ${name} » doit être cochée`
          : `Le champ « ${name} » est requis`;
      continue;
    }
    if (field.type === "select" && value) {
      const options = field.options ?? [];
      if (!options.includes(value)) {
        errors[field.key] = `Valeur « ${value} » invalide pour « ${name} » (choix fermé)`;
        continue;
      }
    }
    if (field.type === "checkbox" && value && value !== CHECKBOX_TRUE) {
      errors[field.key] = `Valeur « ${value} » invalide pour la case « ${name} »`;
      continue;
    }
    if (field.type === "number" && value) {
      const previous = opts.previousValues?.[field.key];
      const unchanged = typeof previous === "string" && value === previous.trim();
      if (!unchanged && !isNumericFieldValue(value)) {
        errors[field.key] = `Le champ « ${name} » attend un nombre (reçu « ${value} »)`;
      }
    }
  }
  return errors;
}

/**
 * Un champ est-il « rempli » au sens de `required` ? Pour un checkbox, rempli
 * signifie coché : une case décochée vaut `""`, exactement comme un texte vide.
 */
export function isFieldFilled(field: CustomField, value: string): boolean {
  return field.type === "checkbox" ? isCheckedFieldValue(value) : value.length > 0;
}

export function validateFieldValues(
  schema: CustomField[],
  values: Record<string, string>,
  opts: ValidateFieldValuesOptions = {}
): string | null {
  const errors = validateFieldValuesAll(schema, values, opts);
  // Clé inconnue d'abord (whitelist stricte), puis l'ordre du schéma — pour
  // que le message d'un formulaire désigne toujours le premier champ fautif
  // tel qu'il est affiché, pas un ordre de clés d'objet.
  if (errors.__unknown) return errors.__unknown;
  for (const field of schema) {
    if (errors[field.key]) return errors[field.key];
  }
  return null;
}

/** Sérialise pour stockage (colonnes String JSON). */
export function serializeCustomFields(fields: CustomField[]): string {
  return JSON.stringify(fields);
}
