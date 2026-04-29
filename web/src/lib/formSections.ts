import { isFormSectionVisible, isSchemaFieldVisible, isSectionComplete } from "@/lib/templateConditions";
import type { SchemaField, TemplateFormSection, TemplateSectionColumnCount } from "@/types/template";

export type ResolvedFormSection = {
  id: string;
  title: string;
  description?: string;
  desktopSpan: "full" | "half";
  fieldColumns: TemplateSectionColumnCount;
  fields: SchemaField[];
};

export const UNSECTIONED_FORM_SECTION_ID = "__unsectioned__";
export const MAX_SECTION_LAYOUT_ROWS = 24;

export function buildVisibleFormSections(
  schema: SchemaField[],
  formSections: TemplateFormSection[],
  values: Record<string, unknown>
): ResolvedFormSection[] {
  const visibleSchema = schema.filter((field) => isSchemaFieldVisible(field, values));
  const explicitGrouped = new Map<string, SchemaField[]>();
  const explicitFields = new Set<string>();

  for (const field of visibleSchema) {
    if (!field.sectionId) continue;
    if (!explicitGrouped.has(field.sectionId)) explicitGrouped.set(field.sectionId, []);
    explicitGrouped.get(field.sectionId)?.push(field);
    explicitFields.add(field.key);
  }

  const orderedExplicitSections: ResolvedFormSection[] = [];
  let previousVisibleSectionFields: SchemaField[] | null = null;
  let progressiveFlowActive = false;
  let progressiveFlowMode: "all" | "required" = "all";
  let firstResolvedSectionHandled = false;

  for (const source of formSections) {
    const fields = explicitGrouped.get(source.id) ?? [];
    if (fields.length === 0) continue;

    const completionMode = source.revealCompletionMode ?? progressiveFlowMode;
    const previousSectionComplete = previousVisibleSectionFields
      ? isSectionComplete(previousVisibleSectionFields, values, completionMode)
      : true;
    const startsProgressiveFlow = !firstResolvedSectionHandled && source.revealWhenPreviousComplete === true;
    const requiresPreviousComplete = progressiveFlowActive || source.revealWhenPreviousComplete === true;

    if (!isFormSectionVisible(source, values, requiresPreviousComplete ? previousSectionComplete : true)) continue;

    orderedExplicitSections.push({
      id: source.id,
      title: source.title,
      description: source.description,
      desktopSpan: source.layout?.desktopSpan ?? "full",
      fieldColumns: source.layout?.fieldColumns ?? 2,
      fields,
    });

    previousVisibleSectionFields = fields;
    firstResolvedSectionHandled = true;
    if (startsProgressiveFlow) {
      progressiveFlowActive = true;
      progressiveFlowMode = source.revealCompletionMode ?? "all";
    }
  }

  const unsectionedFields = visibleSchema.filter((field) => !explicitFields.has(field.key));
  const unsectionedSections: ResolvedFormSection[] = unsectionedFields.length > 0
    ? [{
        id: UNSECTIONED_FORM_SECTION_ID,
        title: "Hors section",
        desktopSpan: "full",
        fieldColumns: 2,
        fields: unsectionedFields,
      }]
    : [];

  return [...orderedExplicitSections, ...unsectionedSections];
}

export function getVisibleFieldKeys(
  schema: SchemaField[],
  formSections: TemplateFormSection[],
  values: Record<string, unknown>
): Set<string> {
  return new Set(
    buildVisibleFormSections(schema, formSections, values)
      .flatMap((section) => section.fields.map((field) => field.key))
  );
}

type PositionedSectionField = {
  field: SchemaField;
  index: number;
  row: number;
  column: number;
};

function getFieldGridSpan(field: SchemaField, columns: number): number {
  // Explicit column placement → always 1 cell; the field is pinned to a specific column.
  if (field.sectionLayout?.column) return 1;
  return (field.type === "image" || field.type === "video") && columns > 1 ? 2 : 1;
}

function canPlaceField(
  occupied: Set<string>,
  row: number,
  column: number,
  span: number,
  columns: number
): boolean {
  if (column < 1 || column + span - 1 > columns) return false;

  for (let offset = 0; offset < span; offset += 1) {
    if (occupied.has(`${row}:${column + offset}`)) return false;
  }

  return true;
}

function reserveFieldCells(occupied: Set<string>, row: number, column: number, span: number) {
  for (let offset = 0; offset < span; offset += 1) {
    occupied.add(`${row}:${column + offset}`);
  }
}

function resolveFieldPosition(
  field: SchemaField,
  occupied: Set<string>,
  columns: number
): { row: number; column: number } {
  const span = getFieldGridSpan(field, columns);
  const preferredRow = field.sectionLayout?.row ? Math.max(1, field.sectionLayout.row) : undefined;
  const preferredColumn = field.sectionLayout?.column
    ? Math.max(1, Math.min(field.sectionLayout.column, Math.max(1, columns - span + 1)))
    : undefined;

  if (preferredRow && preferredColumn && canPlaceField(occupied, preferredRow, preferredColumn, span, columns)) {
    return { row: preferredRow, column: preferredColumn };
  }

  if (preferredRow) {
    for (let column = 1; column <= Math.max(1, columns - span + 1); column += 1) {
      if (canPlaceField(occupied, preferredRow, column, span, columns)) {
        return { row: preferredRow, column };
      }
    }
  }

  if (preferredColumn) {
    for (let row = 1; row <= MAX_SECTION_LAYOUT_ROWS; row += 1) {
      if (canPlaceField(occupied, row, preferredColumn, span, columns)) {
        return { row, column: preferredColumn };
      }
    }
  }

  for (let row = 1; row <= MAX_SECTION_LAYOUT_ROWS; row += 1) {
    for (let column = 1; column <= Math.max(1, columns - span + 1); column += 1) {
      if (canPlaceField(occupied, row, column, span, columns)) {
        return { row, column };
      }
    }
  }

  return { row: MAX_SECTION_LAYOUT_ROWS, column: 1 };
}

export function getSectionFieldsInVisualOrder(fields: SchemaField[], columns: TemplateSectionColumnCount): SchemaField[] {
  if (fields.length <= 1 || columns <= 1) return fields;

  const occupied = new Set<string>();
  const positioned: PositionedSectionField[] = [];

  fields.forEach((field, index) => {
    const position = resolveFieldPosition(field, occupied, columns);
    reserveFieldCells(occupied, position.row, position.column, getFieldGridSpan(field, columns));
    positioned.push({
      field,
      index,
      row: position.row,
      column: position.column,
    });
  });

  return positioned
    .sort((left, right) => {
      if (left.row !== right.row) return left.row - right.row;
      if (left.column !== right.column) return left.column - right.column;
      return left.index - right.index;
    })
    .map((item) => item.field);
}

export function getFormSectionSpanClass(section: Pick<ResolvedFormSection, "desktopSpan">): string {
  return section.desktopSpan === "half" ? "2xl:col-span-1" : "2xl:col-span-2";
}

export function getFormSectionGridClass(section: Pick<ResolvedFormSection, "fieldColumns">): string {
  switch (section.fieldColumns) {
    case 1:
      return "grid grid-cols-1 gap-4 xl:gap-5";
    case 2:
      return "grid grid-cols-1 xl:grid-cols-2 gap-4 xl:gap-5";
    case 3:
      return "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 xl:gap-5";
    case 4:
      return "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 xl:gap-5";
    case 5:
      return "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 xl:gap-5";
    default:
      return "grid grid-cols-1 xl:grid-cols-2 gap-4 xl:gap-5";
  }
}

export function getFieldSpanClass(field: SchemaField, columns: TemplateSectionColumnCount): string {
  if (field.type === "image" || field.type === "video") {
    // Only span the full row when the field has no explicit column placement.
    if (columns > 1 && !field.sectionLayout?.column) return "xl:col-span-2";
    return "xl:col-span-1";
  }
  return "xl:col-span-1";
}

export function getFieldPlacementClass(field: SchemaField, columns: TemplateSectionColumnCount): string {
  const classes: string[] = [];
  const rawColumn = field.sectionLayout?.column;
  const rawRow = field.sectionLayout?.row;

  if (columns > 1 && rawColumn) {
    const start = Math.max(1, Math.min(rawColumn, columns));
    const maxStart = field.type === "image" || field.type === "video"
      ? Math.max(1, columns - 1)
      : columns;
    const normalizedStart = Math.min(start, maxStart);

    switch (normalizedStart) {
      case 1:
        classes.push("xl:col-start-1");
        break;
      case 2:
        classes.push("xl:col-start-2");
        break;
      case 3:
        classes.push("xl:col-start-3");
        break;
      case 4:
        classes.push("xl:col-start-4");
        break;
      case 5:
        classes.push("xl:col-start-5");
        break;
      default:
        break;
    }
  }

  if (rawRow) {
    const normalizedRow = Math.max(1, Math.min(rawRow, MAX_SECTION_LAYOUT_ROWS));
    switch (normalizedRow) {
      case 1:
        classes.push("xl:row-start-1");
        break;
      case 2:
        classes.push("xl:row-start-2");
        break;
      case 3:
        classes.push("xl:row-start-3");
        break;
      case 4:
        classes.push("xl:row-start-4");
        break;
      case 5:
        classes.push("xl:row-start-5");
        break;
      case 6:
        classes.push("xl:row-start-6");
        break;
      case 7:
        classes.push("xl:row-start-7");
        break;
      case 8:
        classes.push("xl:row-start-8");
        break;
      case 9:
        classes.push("xl:row-start-9");
        break;
      case 10:
        classes.push("xl:row-start-10");
        break;
      case 11:
        classes.push("xl:row-start-11");
        break;
      case 12:
        classes.push("xl:row-start-12");
        break;
      default:
        break;
    }
  }

  return classes.join(" ");
}

export function getFieldStaticPlacementStyle(
  field: SchemaField,
  columns: number,
  allowPlacement: boolean
): { gridColumn?: string; gridRow?: string } | undefined {
  if (!allowPlacement) return undefined;
  const rawColumn = field.sectionLayout?.column;
  const rawRow = field.sectionLayout?.row;
  const style: { gridColumn?: string; gridRow?: string } = {};

  if (columns > 1 && rawColumn) {
    // Explicit column placement → span 1; full-row span only for unpinned image/video.
    const span = (field.type === "image" || field.type === "video") && !rawColumn ? 2 : 1;
    const maxStart = Math.max(1, columns - span + 1);
    const start = Math.max(1, Math.min(rawColumn, maxStart));

    style.gridColumn = `${start} / span ${span}`;
  }

  if (rawRow) {
    const row = Math.max(1, Math.min(rawRow, MAX_SECTION_LAYOUT_ROWS));
    style.gridRow = `${row}`;
  }

  return Object.keys(style).length > 0 ? style : undefined;
}

/**
 * Computes per-field inline grid styles for an entire section at once.
 * Knows which row each field occupies, so image/video fields with an explicit
 * column placement that are ALONE on their row still span the full row width.
 */
export function computeSectionFieldStyles(
  fields: SchemaField[],
  columns: TemplateSectionColumnCount,
): Map<string, { gridColumn?: string; gridRow?: string }> {
  const result = new Map<string, { gridColumn?: string; gridRow?: string }>();
  if (columns <= 1) return result;

  // Place all fields to discover row assignments
  const occupied = new Set<string>();
  const positioned: Array<{ key: string; row: number; column: number; isMedia: boolean; rawColumn?: number; rawRow?: number }> = [];

  for (const field of fields) {
    const position = resolveFieldPosition(field, occupied, columns);
    reserveFieldCells(occupied, position.row, position.column, getFieldGridSpan(field, columns));
    positioned.push({
      key: field.key,
      row: position.row,
      column: position.column,
      isMedia: field.type === "image" || field.type === "video",
      rawColumn: field.sectionLayout?.column,
      rawRow: field.sectionLayout?.row,
    });
  }

  // Build a row → keys map to detect lonely fields
  const rowOccupants = new Map<number, string[]>();
  for (const item of positioned) {
    if (!rowOccupants.has(item.row)) rowOccupants.set(item.row, []);
    rowOccupants.get(item.row)!.push(item.key);
  }

  for (const item of positioned) {
    const style: { gridColumn?: string; gridRow?: string } = {};

    if (item.rawColumn) {
      let span = 1;
      if (item.isMedia) {
        // Alone in its row → span full width even though it has an explicit column
        const rowMates = rowOccupants.get(item.row) ?? [];
        if (rowMates.length === 1) span = 2;
      }
      const maxStart = Math.max(1, columns - span + 1);
      const start = Math.max(1, Math.min(item.rawColumn, maxStart));
      style.gridColumn = `${start} / span ${span}`;
    }

    if (item.rawRow) {
      const row = Math.max(1, Math.min(item.rawRow, MAX_SECTION_LAYOUT_ROWS));
      style.gridRow = `${row}`;
    }

    if (Object.keys(style).length > 0) {
      result.set(item.key, style);
    }
  }

  return result;
}