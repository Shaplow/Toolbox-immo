/**
 * Feuille de calcul des fiches d'une bibliothèque de données, telle que le
 * client la reçoit dans son .xlsx : une colonne « Dossier », puis une colonne
 * par champ du schéma de la bibliothèque, une ligne par fiche.
 *
 * Ce module ne fait QUE préparer les cellules (colonnes, lignes de texte) ;
 * l'écriture du classeur (exceljs) reste dans la route publique `data`.
 *
 * Pur : aucun import serveur (ce module est aussi chargé dans Vitest).
 */

import { normalizeCustomFields } from "@/lib/customFields";
import { isReservedSetTag } from "@/lib/rotation/sentinels";

export interface DataSheetColumn {
  key: string;
  label: string;
}

/** Clé de la première colonne (le Dossier, `DataEntry.setTag`) : jamais un champ du schéma. */
export const DOSSIER_COLUMN_KEY = "__dossier";

/** Clés que l'import réserve et que `fields` ne porte pas (sauf données historiques). */
const RESERVED_FIELD_KEYS: ReadonlySet<string> = new Set(["set_tag", "category"]);

/** Une cellule Excel contient au plus 32 767 caractères : au-delà, le fichier est signalé corrompu. */
const MAX_CELL_LENGTH = 32_767;

/** Excel limite le nom d'un onglet à 31 caractères. */
const MAX_SHEET_NAME_LENGTH = 31;

type FieldValues = Record<string, unknown>;

/** `fields` est du JSON saisi ou importé : illisible ou pas un objet → null, jamais d'exception. */
function parseFields(json: string): FieldValues | null {
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as FieldValues) : null;
  } catch {
    return null;
  }
}

/**
 * Texte d'une cellule. Les caractères de contrôle (hors tabulation et retours
 * à la ligne) sont interdits en XML : l'écrivain les retire ou produit un
 * fichier qu'Excel « répare » ; les moitiés de paire orphelines aussi.
 */
function cellText(text: string): string {
  let clean = text.replace(/[\p{Cc}\p{Cs}\p{Noncharacter_Code_Point}]/gu, (ch) =>
    ch === "\t" || ch === "\n" || ch === "\r" ? ch : "",
  );
  if (clean.length > MAX_CELL_LENGTH) {
    clean = clean.slice(0, MAX_CELL_LENGTH);
    // Pas de coupe au milieu d'une paire de substitution (emoji).
    const last = clean.charCodeAt(clean.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) clean = clean.slice(0, -1);
  }
  return clean;
}

/** Valeur d'un champ : texte tel quel, nombre / booléen en toutes lettres, objet en JSON, rien en vide. */
function cellValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return cellText(value);
  if (typeof value === "object") return cellText(JSON.stringify(value) ?? "");
  return cellText(String(value));
}

/**
 * Colonnes de champs déclarées par le schéma de la bibliothèque (ordre déclaré,
 * libellés) ; null si la bibliothèque n'a pas de schéma — les colonnes sont
 * alors l'union des clés des fiches, à collecter avec collectFieldKeys.
 */
export function declaredFieldColumns(fieldsSchema: string): DataSheetColumn[] | null {
  const declared = normalizeCustomFields(fieldsSchema);
  return declared.length > 0 ? declared.map((field) => ({ key: field.key, label: field.label })) : null;
}

/**
 * Bibliothèque sans schéma (héritage, ou jamais configuré) : ajoute à `keys` les
 * clés d'une fiche, dans l'ordre où elles apparaissent. Appelée fiche par fiche,
 * elle permet un premier passage en flux sur une très grosse bibliothèque.
 */
export function collectFieldKeys(keys: Set<string>, fieldsJson: string): void {
  const fields = parseFields(fieldsJson);
  if (!fields) return;
  for (const key of Object.keys(fields)) if (!RESERVED_FIELD_KEYS.has(key)) keys.add(key);
}

/** Colonnes complètes : « Dossier » puis les champs. */
export function sheetColumns(fieldColumns: DataSheetColumn[]): DataSheetColumn[] {
  return [{ key: DOSSIER_COLUMN_KEY, label: "Dossier" }, ...fieldColumns];
}

/**
 * Cellules d'une fiche, aussi nombreuses que sheetColumns(fieldColumns). Une
 * fiche dont `fields` est illisible garde son Dossier et donne des cellules
 * vides : un export ne s'arrête pas pour une ligne cassée.
 */
export function dataSheetRow(
  fieldColumns: DataSheetColumn[],
  entry: { fields: string; setTag: string | null },
): string[] {
  const fields = parseFields(entry.fields);
  // Les anciens dossiers auto-générés (pack_*) sont masqués partout dans l'UI.
  const dossier = entry.setTag && !isReservedSetTag(entry.setTag) ? cellText(entry.setTag.trim()) : "";
  return [
    dossier,
    // Propriétés propres seulement : un champ « constructor » ne doit pas remonter le prototype.
    ...fieldColumns.map((column) =>
      fields && Object.prototype.hasOwnProperty.call(fields, column.key) ? cellValue(fields[column.key]) : "",
    ),
  ];
}

/**
 * Feuille complète en mémoire (petites bibliothèques, tests) : colonnes
 * « Dossier » + champs du schéma, ou union des clés des fiches ; une ligne par
 * fiche, dans l'ordre reçu. La route publique `data` écrit, elle, en flux avec
 * les helpers ci-dessus.
 */
export function buildDataSheet(input: {
  fieldsSchema: string;
  entries: Array<{ fields: string; setTag: string | null }>;
}): { columns: DataSheetColumn[]; rows: string[][] } {
  let fieldColumns = declaredFieldColumns(input.fieldsSchema);
  if (!fieldColumns) {
    const keys = new Set<string>();
    for (const entry of input.entries) collectFieldKeys(keys, entry.fields);
    fieldColumns = [...keys].map((key) => ({ key, label: key }));
  }
  const columns = sheetColumns(fieldColumns);
  const rows = input.entries.map((entry) => dataSheetRow(fieldColumns, entry));
  return { columns, rows };
}

function isSheetEdge(ch: string): boolean {
  return ch === "'" || ch === " ";
}

/** Retire apostrophes et espaces en tête et en queue (Excel refuse un nom qui commence ou finit par « ' »). */
function trimSheetEdges(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && isSheetEdge(value[start])) start += 1;
  while (end > start && isSheetEdge(value[end - 1])) end -= 1;
  return value.slice(start, end);
}

/**
 * Nom d'onglet accepté par Excel : sans `[ ] : * ? / \`, ni caractères de
 * contrôle, ni apostrophe en bout, 31 caractères au plus, et jamais vide ni
 * « History » (nom réservé par Excel, dans toutes les langues). Les caractères
 * interdits sont retirés, pas remplacés : « Prix [€/m²] » donne « Prix €m² ».
 */
export function sanitizeSheetName(name: string): string {
  const fallback = "Données";
  const cleaned = trimSheetEdges(
    String(name ?? "")
      .slice(0, 256)
      .replace(/[\p{Cc}\p{Cs}\p{Noncharacter_Code_Point}[\]:*?/\\]/gu, ""),
  );

  let cut = cleaned.slice(0, MAX_SHEET_NAME_LENGTH);
  if (cut.length < cleaned.length) {
    const last = cut.charCodeAt(cut.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  }
  const result = trimSheetEdges(cut);

  // « History » est réservé par Excel, quelle que soit la casse.
  if (!result || result.toLowerCase() === "history") return fallback;
  return result;
}
