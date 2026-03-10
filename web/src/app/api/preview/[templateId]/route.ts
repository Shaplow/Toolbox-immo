import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildHTML } from "@/lib/renderer/buildHTML";
import type { TemplateJSON, SchemaField } from "@/types/template";
import type { ListingData } from "@/types/listing";

/** Build placeholder listing data from schema defaults */
function placeholderData(schema: SchemaField[]): ListingData {
  const out: Record<string, unknown> = {
    georisques_mention:
      "Les risques et pollutions de ce bien sont consultables sur georisques.gouv.fr",
  };
  for (const field of schema) {
    if (field.default !== undefined && field.default !== "") {
      out[field.key] = field.default;
    } else {
      switch (field.type) {
        case "number":
          out[field.key] = 0;
          break;
        case "boolean":
          out[field.key] = false;
          break;
        case "select":
          out[field.key] = field.options?.[0] ?? "";
          break;
        default:
          out[field.key] = field.placeholder ?? `[${field.label}]`;
      }
    }
  }
  return out as ListingData;
}

/**
 * GET  /api/preview/[templateId]  — preview with schema defaults (builder)
 * POST /api/preview/[templateId]  — preview with provided data (listing form)
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ templateId: string }> }
) {
  const { templateId } = await params;
  try {
    const template = await prisma.template.findUniqueOrThrow({
      where: { id: templateId },
    });
    const json = JSON.parse(template.jsonData) as TemplateJSON;
    const data = placeholderData(json.schema);
    const html = await buildHTML(json, data);
    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ templateId: string }> }
) {
  const { templateId } = await params;
  try {
    const body = await req.json() as { data?: Record<string, unknown> };
    const template = await prisma.template.findUniqueOrThrow({
      where: { id: templateId },
    });
    const json = JSON.parse(template.jsonData) as TemplateJSON;
    // Merge provided data over placeholder defaults
    const defaults = placeholderData(json.schema);
    const data = { ...defaults, ...(body.data ?? {}) } as ListingData;
    const html = await buildHTML(json, data);
    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch {
    return NextResponse.json({ error: "Preview failed" }, { status: 500 });
  }
}
