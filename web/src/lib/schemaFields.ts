import type { ListingData } from "@/types/listing";
import type { DecimalSeparator } from "@/lib/numberFormatting";
import type { ConditionMatch, SchemaField, SchemaFieldSectionLayout, SchemaFieldType, TemplateFormSection, TemplateFormSectionLayout, TemplateSectionColumnCount } from "@/types/template";

export const SCHEMA_FIELD_TYPES: { value: SchemaFieldType; label: string }[] = [
  { value: "text", label: "Texte" },
  { value: "number", label: "Nombre" },
  { value: "url", label: "URL" },
  { value: "image", label: "Image" },
  { value: "video", label: "Vidéo" },
  { value: "audio", label: "Audio" },
  { value: "select", label: "Liste (select)" },
  { value: "boolean", label: "Oui / Non" },
];

export const EMPTY_SCHEMA_FIELD: Omit<SchemaField, "key"> = {
  label: "",
  sectionId: undefined,
  sectionLayout: undefined,
  type: "text",
  required: false,
  placeholder: "",
  formatThousands: false,
  decimalSeparator: "," satisfies DecimalSeparator,
  description: undefined,
  options: [],
};

export function createFormSectionId(title: string): string {
  const base = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return base || `section-${Date.now()}`;
}

export function normalizeFormSection(section: TemplateFormSection): TemplateFormSection | null {
  const id = String(section.id ?? "").trim();
  const title = String(section.title ?? "").trim();
  if (!id || !title) return null;
  const description = String(section.description ?? "").trim();
  return {
    id,
    title,
    description: description || undefined,
    conditions: normalizeFormSectionConditions(section.conditions, section.showIf),
    revealWhenPreviousComplete: section.revealWhenPreviousComplete === true ? true : undefined,
    revealCompletionMode: section.revealCompletionMode === "required" ? "required" : undefined,
    layout: normalizeFormSectionLayout(section.layout),
  };
}

export function normalizeFormSectionConditions(
  conditions: ConditionMatch[] | undefined,
  legacyCondition?: ConditionMatch
): ConditionMatch[] | undefined {
  const normalized = [
    ...(conditions ?? []),
    ...(legacyCondition ? [legacyCondition] : []),
  ]
    .map((condition) => normalizeConditionMatch(condition))
    .filter((condition): condition is ConditionMatch => condition !== undefined);

  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeFormSectionLayout(layout: TemplateFormSectionLayout | undefined): TemplateFormSectionLayout | undefined {
  if (!layout) return undefined;

  const desktopSpan = layout.desktopSpan === "half" ? "half" : "full";
  const allowedFieldColumns: TemplateSectionColumnCount[] = [1, 2, 3, 4, 5];
  const fieldColumns = allowedFieldColumns.includes(layout.fieldColumns as TemplateSectionColumnCount)
    ? layout.fieldColumns as TemplateSectionColumnCount
    : 2;
  const rowCount = typeof layout.rowCount === "number" && Number.isFinite(layout.rowCount)
    ? Math.max(1, Math.min(24, Math.round(layout.rowCount)))
    : undefined;

  if (desktopSpan === "full" && fieldColumns === 2 && !rowCount) return undefined;

  return {
    desktopSpan,
    fieldColumns,
    ...(rowCount ? { rowCount } : {}),
  };
}

export function normalizeSchemaFieldSectionLayout(layout: SchemaFieldSectionLayout | undefined): SchemaFieldSectionLayout | undefined {
  if (!layout) return undefined;
  const allowedColumns: TemplateSectionColumnCount[] = [1, 2, 3, 4, 5];
  const column = allowedColumns.includes(layout.column as TemplateSectionColumnCount)
    ? layout.column as TemplateSectionColumnCount
    : undefined;
  const row = typeof layout.row === "number" && Number.isFinite(layout.row)
    ? Math.max(1, Math.min(24, Math.round(layout.row)))
    : undefined;

  return column || row ? { ...(column ? { column } : {}), ...(row ? { row } : {}) } : undefined;
}

export function validateSchemaFieldKey(key: string, existingKeys: string[]): string | null {
  const trimmed = key.trim();
  if (!trimmed) return "Clé requise";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    return "Clé : lettres, chiffres et _ uniquement";
  }
  if (existingKeys.includes(trimmed)) return "Cette clé existe déjà";
  return null;
}

export function createDuplicateSchemaFieldKey(key: string, existingKeys: string[]): string {
  const trimmed = key.trim();
  const safeKey = trimmed
    ? trimmed.replace(/[^A-Za-z0-9_]/g, "_")
    : "Champ";
  const normalizedKey = /^[A-Za-z_]/.test(safeKey) ? safeKey : `_${safeKey}`;
  const baseKey = `${normalizedKey}_copie`;

  if (!existingKeys.includes(baseKey)) return baseKey;

  let suffix = 2;
  while (existingKeys.includes(`${baseKey}_${suffix}`)) {
    suffix += 1;
  }

  return `${baseKey}_${suffix}`;
}

export function parseSelectOptions(raw: string): string[] {
  return raw.split("\n").map((value) => value.trim()).filter(Boolean);
}

export function isConditionSourceField(field: SchemaField): boolean {
  return field.type === "select" || field.type === "boolean";
}

export function getConditionSourceFields(schema: SchemaField[], excludeKey?: string): SchemaField[] {
  return schema.filter((field) => field.key !== excludeKey && isConditionSourceField(field));
}

export function getConditionDriverFields(
  schema: SchemaField[],
  formSections: TemplateFormSection[]
): SchemaField[] {
  const referencedKeys = new Set<string>();

  for (const field of schema) {
    if (field.showIf?.field) referencedKeys.add(field.showIf.field);
  }

  for (const section of formSections) {
    for (const condition of section.conditions ?? []) {
      if (condition.field) referencedKeys.add(condition.field);
    }
    if (section.showIf?.field) referencedKeys.add(section.showIf.field);
  }

  return schema.filter((field) => referencedKeys.has(field.key) && isConditionSourceField(field));
}

export function getConditionValueOptions(field: SchemaField | undefined): Array<{ value: string; label: string }> {
  if (!field) return [];
  if (field.type === "boolean") {
    return [
      { value: "true", label: "Oui" },
      { value: "false", label: "Non" },
    ];
  }
  if (field.type === "select") {
    return (field.options ?? []).map((option) => ({ value: option, label: option }));
  }
  return [];
}

export function buildSchemaPreviewData(schema: SchemaField[]): ListingData {
  const out: Record<string, unknown> = {
    georisques_mention:
      "Les risques et pollutions de ce bien sont consultables sur georisques.gouv.fr",
  };

  for (const field of schema) {
    // 1. Valeur par défaut explicite
    if (field.default !== undefined && field.default !== null && field.default !== "") {
      out[field.key] = field.default;
      continue;
    }

    // 2. Placeholder (pour tous les types avant les fallbacks)
    if (field.placeholder !== undefined && field.placeholder !== null && field.placeholder !== "") {
      out[field.key] = field.placeholder;
      continue;
    }

    // 3. Fallbacks par type
    switch (field.type) {
      case "boolean":
        // Utilisé dans les conditionnels, pas en texte direct
        out[field.key] = false;
        break;
      case "select":
        // Premier choix si disponible, sinon variable brute
        out[field.key] = field.options?.[0] ?? `{{${field.key}}}`;
        break;
      default:
        // Texte, nombre, image… : laisser la variable visible
        out[field.key] = `{{${field.key}}}`;
        break;
    }
  }

  return out as ListingData;
}

export function normalizeSchemaField(field: SchemaField): SchemaField {
  const { usePlaceholderAsInitialValue: _legacyPlaceholderInitialValue, ...rest } = field as SchemaField & {
    usePlaceholderAsInitialValue?: boolean;
  };

  return {
    ...EMPTY_SCHEMA_FIELD,
    ...rest,
    key: rest.key,
    label: rest.label ?? rest.key,
    sectionId: rest.sectionId ? String(rest.sectionId).trim() : undefined,
    sectionLayout: normalizeSchemaFieldSectionLayout(rest.sectionLayout),
    required: Boolean(rest.required),
    options: rest.type === "select" ? (rest.options ?? []) : undefined,
    formatThousands: rest.type === "number" ? rest.formatThousands ?? false : false,
    decimalSeparator: rest.type === "number" ? (rest.decimalSeparator ?? ",") : undefined,
    showIf: normalizeConditionMatch(rest.showIf),
  };
}

export function normalizeConditionMatch(condition: ConditionMatch | undefined): ConditionMatch | undefined {
  if (!condition) return undefined;
  const field = String(condition.field ?? "").trim();
  const equals = String(condition.equals ?? "").trim();
  if (!field) return undefined;
  return { field, equals };
}
