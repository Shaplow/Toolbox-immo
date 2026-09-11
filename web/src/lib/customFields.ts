/**
 * customFields — modèle CANONIQUE de « champ personnalisé » typé, partagé par :
 *   - Property (Bien), PublicationSlot/mission, PatternTemplate/recette
 *   - MediaLibrary.metadataSchema, DataLibrary.fieldsSchema
 *
 * Remplace les 6 déclarations concurrentes (FieldDef / MetadataField / string[]).
 * 5 types : text / textarea / number / url / select (choix fermé via `options`).
 * Les valeurs restent stockées en string (le type pilote le rendu/l'édition,
 * pas de coercition serveur — cohérent avec tout le repo). `CustomFieldType`
 * est un sous-ensemble strict de `SchemaFieldType` (cf. customFieldToSchemaField).
 */

import type { SchemaField } from "@/types/template";
import { validateSchemaFieldKey } from "@/lib/schemaFields";

export type CustomFieldType = "text" | "textarea" | "number" | "url" | "select";

export interface CustomField {
  key: string;
  label: string;
  type: CustomFieldType;
  /** Champ obligatoire (utilisé par Data/formulaires ; optionnel ailleurs). */
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
];

const VALID_TYPES = new Set<CustomFieldType>(["text", "textarea", "number", "url", "select"]);

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

/** Convertit un champ perso en `SchemaField` pour la fusion dans le formulaire
 *  de génération. Les CustomFieldType sont tous des `SchemaFieldType` valides. */
export function customFieldToSchemaField(f: CustomField): SchemaField {
  const field: SchemaField = {
    key: f.key,
    label: f.label || f.key,
    type: f.type,
    required: Boolean(f.required),
  };
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

export function validateFieldValues(
  schema: CustomField[],
  values: Record<string, string>,
  opts: {
    requireRequired?: boolean;
    allowUnknownKeys?: boolean;
    previousValues?: Record<string, string>;
  } = {}
): string | null {
  const byKey = new Map(schema.map((f) => [f.key, f]));

  if (!opts.allowUnknownKeys && schema.length > 0) {
    for (const key of Object.keys(values)) {
      if (!byKey.has(key)) return `Champ inconnu : « ${key} »`;
    }
  }

  for (const field of schema) {
    const raw = values[field.key];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (opts.requireRequired && field.required && !value) {
      return `Le champ « ${field.label || field.key} » est requis`;
    }
    if (field.type === "select" && value) {
      const options = field.options ?? [];
      if (!options.includes(value)) {
        return `Valeur « ${value} » invalide pour « ${field.label || field.key} » (choix fermé)`;
      }
    }
    if (field.type === "number" && value) {
      const previous = opts.previousValues?.[field.key];
      const unchanged = typeof previous === "string" && value === previous.trim();
      if (!unchanged && !isNumericFieldValue(value)) {
        return `Le champ « ${field.label || field.key} » attend un nombre (reçu « ${value} »)`;
      }
    }
  }
  return null;
}

/** Sérialise pour stockage (colonnes String JSON). */
export function serializeCustomFields(fields: CustomField[]): string {
  return JSON.stringify(fields);
}
