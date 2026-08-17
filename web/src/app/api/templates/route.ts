import { NextRequest, NextResponse } from "next/server";
import { requireUser, requireAdmin } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import { emptyTemplate } from "@/types/template";
import { serializeTemplateJSON } from "@/lib/templateNormalization";

// GET /api/templates
export async function GET() {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;

  let templates;
  if (userContext.canAdminBypass) {
    // Admin voit toutes les templates
    templates = await prisma.template.findMany({
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, client: true, formats: true, createdAt: true, updatedAt: true },
    });
  } else {
    // User voit uniquement les templates qui lui ont été assignés
    const accesses = await prisma.templateAccess.findMany({
      where: { userId: userContext.effectiveUser.id },
      include: {
        template: {
          select: { id: true, name: true, client: true, formats: true, contentType: true, createdAt: true, updatedAt: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    templates = accesses.map((a) => a.template);
  }

  return NextResponse.json(
    templates.map((t) => ({ ...t, formats: JSON.parse(t.formats) as string[] }))
  );
}

// POST /api/templates — ADMIN seulement
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;

  const body = await req.json().catch(() => ({}));
  const { name = "Nouveau template", client = "", format = "A3_LANDSCAPE", width, height } = body;

  const json = emptyTemplate();
  const { CANVAS_FORMATS, defaultCanvas } = await import("@/types/template");
  if (format in CANVAS_FORMATS) {
    json.canvas = defaultCanvas(format);
  }
  if (format === "CUSTOM") {
    json.canvas = {
      ...json.canvas,
      format: "CUSTOM",
      width: Math.max(1, Number(width) || 1920),
      height: Math.max(1, Number(height) || 1080),
    };
  }

  const template = await prisma.template.create({
    data: {
      name,
      client,
      formats: JSON.stringify([format]),
      jsonData: JSON.stringify(serializeTemplateJSON(json)),
      userId: userContext.effectiveUser.id,
    },
  });

  return NextResponse.json({ ...template, formats: [format] }, { status: 201 });
}
