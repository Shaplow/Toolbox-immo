import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { buildHTML } from "@/lib/renderer/buildHTML";
import { buildSchemaPreviewData } from "@/lib/schemaFields";
import { normalizeTemplateJSON } from "@/lib/templateNormalization";
import type { TemplateJSON } from "@/types/template";
import type { ListingData } from "@/types/listing";

/**
 * GET  /api/preview/[templateId]  — preview with schema defaults (builder)
 * POST /api/preview/[templateId]  — preview with provided data (listing form)
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ templateId: string }> }
) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { templateId } = await params;
  try {
    const template = await prisma.template.findUniqueOrThrow({
      where: { id: templateId },
    });
    const json = normalizeTemplateJSON(JSON.parse(template.jsonData) as TemplateJSON);
    const data = buildSchemaPreviewData(json.schema);
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
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { templateId } = await params;
  try {
    const body = await req.json() as { data?: Record<string, unknown> };
    const template = await prisma.template.findUniqueOrThrow({
      where: { id: templateId },
    });
    const json = normalizeTemplateJSON(JSON.parse(template.jsonData) as TemplateJSON);
    // Merge provided data over placeholder defaults
    const defaults = buildSchemaPreviewData(json.schema);
    const data = { ...defaults, ...(body.data ?? {}) } as ListingData;
    const html = await buildHTML(json, data);
    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch {
    return NextResponse.json({ error: "Preview failed" }, { status: 500 });
  }
}
