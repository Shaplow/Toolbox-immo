import { normalizeTemplateJSON, serializeTemplateJSON } from "@/lib/templateNormalization";
import type { TemplateJSON } from "@/types/template";

export const TEMPLATE_TRANSFER_VERSION = 1;

export type TemplateTransferPayload = {
  version: number;
  exportedAt: string;
  template: {
    name: string;
    client: string;
    formats: string[];
    jsonData: TemplateJSON;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const next = value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  return next.length > 0 ? next : null;
}

export function buildTemplateTransferPayload(input: {
  name: string;
  client?: string | null;
  formats: string[];
  jsonData: TemplateJSON;
}): TemplateTransferPayload {
  return {
    version: TEMPLATE_TRANSFER_VERSION,
    exportedAt: new Date().toISOString(),
    template: {
      name: input.name.trim() || "Template importé",
      client: input.client?.trim() ?? "",
      formats: input.formats,
      jsonData: serializeTemplateJSON(input.jsonData),
    },
  };
}

export function parseTemplateTransferPayload(payload: unknown): {
  name: string;
  client: string;
  formats: string[];
  jsonData: TemplateJSON;
} {
  if (!isRecord(payload)) {
    throw new Error("Format d'import invalide");
  }

  const wrappedTemplate = isRecord(payload.template) ? payload.template : payload;
  const name = typeof wrappedTemplate.name === "string" ? wrappedTemplate.name.trim() : "";
  const client = typeof wrappedTemplate.client === "string" ? wrappedTemplate.client.trim() : "";
  const formats = readStringArray(wrappedTemplate.formats) ?? ["A3_LANDSCAPE"];
  const rawJsonData = wrappedTemplate.jsonData;

  if (!name) {
    throw new Error("Le nom du template est manquant dans le fichier");
  }

  if (!isRecord(rawJsonData)) {
    throw new Error("Le contenu jsonData du template est invalide");
  }

  return {
    name,
    client,
    formats,
    jsonData: normalizeTemplateJSON(rawJsonData as unknown as TemplateJSON),
  };
}

export function buildTemplateExportFilename(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "template";

  return `${slug}.template.json`;
}