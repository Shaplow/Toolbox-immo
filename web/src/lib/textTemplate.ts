import { formatPrice } from "@/types/listing";
import type { ListingData } from "@/types/listing";
import type { SchemaField } from "@/types/template";
import { formatConfiguredNumber, toFlexibleNumber } from "@/lib/numberFormatting";

export type TextTemplateSegment =
  | { type: "text"; value: string }
  | { type: "variable"; key: string }
  | { type: "if"; field: string; equals: string; thenContent: string; elseContent?: string };

const VARIABLE_RE = /^[A-Za-z_]\w*$/;

function parseIfBlock(input: string, start: number): { segment: TextTemplateSegment; end: number } | null {
  const headerEnd = input.indexOf("}}", start);
  if (headerEnd === -1) return null;

  const header = input.slice(start, headerEnd + 2);
  const match = header.match(/^\{\{#if\s+(\w+)\s*==\s*"?([^"}\s]+)"?\s*\}\}$/);
  if (!match) return null;

  const [, field, equals] = match;
  const contentStart = headerEnd + 2;
  let cursor = contentStart;
  let depth = 1;
  let elseIndex = -1;

  while (cursor < input.length) {
    if (input.startsWith("{{#if", cursor)) {
      depth += 1;
      cursor += 5;
      continue;
    }
    if (input.startsWith("{{else}}", cursor) && depth === 1 && elseIndex === -1) {
      elseIndex = cursor;
      cursor += 8;
      continue;
    }
    if (input.startsWith("{{/if}}", cursor)) {
      depth -= 1;
      if (depth === 0) {
        const closeIndex = cursor;
        return {
          segment: {
            type: "if",
            field,
            equals,
            thenContent: input.slice(contentStart, elseIndex === -1 ? closeIndex : elseIndex),
            elseContent: elseIndex === -1 ? undefined : input.slice(elseIndex + 8, closeIndex),
          },
          end: cursor + 7,
        };
      }
      cursor += 7;
      continue;
    }
    cursor += 1;
  }

  return null;
}

export function parseTextTemplate(input: string): TextTemplateSegment[] {
  const segments: TextTemplateSegment[] = [];
  let cursor = 0;
  let textBuffer = "";

  function flushText() {
    if (!textBuffer) return;
    segments.push({ type: "text", value: textBuffer });
    textBuffer = "";
  }

  while (cursor < input.length) {
    if (input.startsWith("{{#if", cursor)) {
      const parsed = parseIfBlock(input, cursor);
      if (parsed) {
        flushText();
        segments.push(parsed.segment);
        cursor = parsed.end;
        continue;
      }
    }

    if (input.startsWith("{{", cursor)) {
      const closeIndex = input.indexOf("}}", cursor + 2);
      if (closeIndex !== -1) {
        const inner = input.slice(cursor + 2, closeIndex).trim();
        if (VARIABLE_RE.test(inner) && inner !== "else") {
          flushText();
          segments.push({ type: "variable", key: inner });
          cursor = closeIndex + 2;
          continue;
        }
      }
    }

    textBuffer += input[cursor];
    cursor += 1;
  }

  flushText();
  return segments;
}

export function compileTextTemplate(segments: TextTemplateSegment[]): string {
  return segments
    .map((segment) => {
      if (segment.type === "text") return segment.value;
      if (segment.type === "variable") return `{{${segment.key.trim()}}}`;
      const elsePart = segment.elseContent !== undefined ? `{{else}}${segment.elseContent}` : "";
      return `{{#if ${segment.field.trim()} == ${segment.equals.trim()}}}${segment.thenContent}${elsePart}{{/if}}`;
    })
    .join("");
}

export function extractTemplateVars(input: string): string[] {
  const found = new Set<string>();

  for (const segment of parseTextTemplate(input)) {
    if (segment.type === "variable" && segment.key !== "else") {
      found.add(segment.key);
      continue;
    }
    if (segment.type === "if") {
      for (const key of extractTemplateVars(segment.thenContent)) found.add(key);
      for (const key of extractTemplateVars(segment.elseContent ?? "")) found.add(key);
    }
  }

  return [...found];
}

export function extractConditionFields(input: string): { field: string; values: string[] }[] {
  const found = new Map<string, Set<string>>();

  for (const segment of parseTextTemplate(input)) {
    if (segment.type !== "if") continue;
    if (!found.has(segment.field)) found.set(segment.field, new Set());
    found.get(segment.field)?.add(segment.equals);
    for (const nested of extractConditionFields(segment.thenContent)) {
      if (!found.has(nested.field)) found.set(nested.field, new Set());
      nested.values.forEach((value) => found.get(nested.field)?.add(value));
    }
    for (const nested of extractConditionFields(segment.elseContent ?? "")) {
      if (!found.has(nested.field)) found.set(nested.field, new Set());
      nested.values.forEach((value) => found.get(nested.field)?.add(value));
    }
  }

  return [...found.entries()].map(([field, values]) => ({ field, values: [...values] }));
}

function resolveVariableValue(
  key: string,
  listing: ListingData,
  schema?: SchemaField[]
): string {
  const raw = (listing as Record<string, unknown>)[key];
  const numericValue = toFlexibleNumber(raw);
  if (key === "price_eur" && numericValue !== null) return formatPrice(numericValue);

  const field = schema?.find((item) => item.key === key);
  if (field?.type === "number") {
    return formatConfiguredNumber(raw, {
      formatThousands: field.formatThousands,
      decimalSeparator: field.decimalSeparator,
    }) ?? String(raw ?? "");
  }

  return String(raw ?? "");
}

export function resolveTextTemplate(input: string, listing: ListingData, schema?: SchemaField[]): string {
  return parseTextTemplate(input)
    .map((segment) => {
      if (segment.type === "text") return segment.value;
      if (segment.type === "variable") {
        return resolveVariableValue(segment.key, listing, schema);
      }
      const actual = String((listing as Record<string, unknown>)[segment.field] ?? "");
      const branch = actual === segment.equals ? segment.thenContent : segment.elseContent ?? "";
      return resolveTextTemplate(branch, listing, schema);
    })
    .join("");
}