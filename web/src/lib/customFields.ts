/**
 * customFields — modèle CANONIQUE de « champ personnalisé » typé, partagé par :
 *   - Property (Bien), PublicationSlot/mission, PatternTemplate/recette
 *   - MediaLibrary.metadataSchema, DataLibrary.fieldsSchema
 *
 * Remplace les 6 déclarations concurrentes (FieldDef / MetadataField / string[]).
 * 4 types alignés sur la médiathèque. Les valeurs restent stockées en string
 * (le type pilote le rendu/l'édition, pas de coercition serveur — cohérent
 * avec tout le repo). `CustomFieldType` est un sous-ensemble strict de
 * `SchemaFieldType` (cf. customFieldToSchemaField).
 */

import type { SchemaField } from "@/types/template";
import { validateSchemaFieldKey } from "@/lib/schemaFields";

export type CustomFieldType = "text" | "textarea" | "number" | "url";

export interface CustomField {
  key: string;
  label: string;
  type: CustomFieldType;
  /** Champ obligatoire (utilisé par Data/formulaires ; optionnel ailleurs). */
  required?: boolean;
  /** Data spreadsheet : visible dans la vue table compacte. Extension optionnelle. */
  primary?: boolean;
}

export const CUSTOM_FIELD_TYPES: { value: CustomFieldType; label: string }[] = [
  { value: "text", label: "Texte" },
  { value: "textarea", label: "Texte long" },
  { value: "number", label: "Nombre" },
  { value: "url", label: "Lien URL" },
];

const VALID_TYPES = new Set<CustomFieldType>(["text", "textarea", "number", "url"]);

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
      out.push(field);
    }
  }
  return out;
}

/** Convertit un champ perso en `SchemaField` pour la fusion dans le formulaire
 *  de génération. Les 4 CustomFieldType sont tous des `SchemaFieldType` valides. */
export function customFieldToSchemaField(f: CustomField): SchemaField {
  return {
    key: f.key,
    label: f.label || f.key,
    type: f.type,
    required: Boolean(f.required),
  };
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
  }
  return null;
}

/** Sérialise pour stockage (colonnes String JSON). */
export function serializeCustomFields(fields: CustomField[]): string {
  return JSON.stringify(fields);
}
