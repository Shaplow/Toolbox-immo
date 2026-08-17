import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import { buildHTML } from "@/lib/renderer/buildHTML";
import { buildSchemaPreviewData } from "@/lib/schemaFields";
import { normalizeTemplateJSON } from "@/lib/templateNormalization";
import { canAccessTemplate } from "@/lib/permissions";
import type { TemplateJSON } from "@/types/template";
import type { ListingData } from "@/types/listing";

/**
 * GET  /api/preview/[templateId]  — preview with schema defaults (builder)
 * POST /api/preview/[templateId]  — preview with provided data (listing form)
 *
 * Permission : canAccessTemplate côté serveur — sinon n'importe quel utilisateur
 * authentifié (y compris EXTERNAL_GENERATOR) pourrait énumérer les templateIds
 * et obtenir le HTML rendu de templates auxquels il n'a pas accès via TemplateAccess.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ templateId: string }> }
) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;

  const { templateId } = await params;
  const ok = await canAccessTemplate(
    userContext.effectiveUser.id,
    templateId,
    userContext.effectiveUser.role ?? undefined,
  );
  if (!ok) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

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
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;

  const { templateId } = await params;
  const ok = await canAccessTemplate(
    userContext.effectiveUser.id,
    templateId,
    userContext.effectiveUser.role ?? undefined,
  );
  if (!ok) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

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
