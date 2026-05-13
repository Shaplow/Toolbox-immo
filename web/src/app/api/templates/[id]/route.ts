import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessTemplate } from "@/lib/permissions";
import { normalizeTemplateJSON, serializeTemplateJSON } from "@/lib/templateNormalization";

type Params = { params: Promise<{ id: string }> };

// GET /api/templates/:id — propriétaire admin OU user avec accès
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const { id } = await params;

  const ok = await canAccessTemplate(session.user.id, id, session.user.role ?? undefined);
  if (!ok) return NextResponse.json({ error: "Template introuvable" }, { status: 404 });

  const template = await prisma.template.findUnique({ where: { id } });
  if (!template) return NextResponse.json({ error: "Template introuvable" }, { status: 404 });

  return NextResponse.json({
    ...template,
    formats: JSON.parse(template.formats) as string[],
    jsonData: normalizeTemplateJSON(JSON.parse(template.jsonData)),
  });
}

// PUT /api/templates/:id — propriétaire admin seulement
export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }
  const { id } = await params;

  const existing = await prisma.template.findFirst({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Template introuvable" }, { status: 404 });
  }

  const body = await req.json();
  const { name, client, formats, jsonData, contentType } = body;

  const updated = await prisma.template.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(client !== undefined && { client }),
      ...(contentType !== undefined && { contentType }),
      ...(formats !== undefined && { formats: JSON.stringify(formats) }),
      ...(jsonData !== undefined && {
        jsonData: typeof jsonData === "string"
          ? JSON.stringify(serializeTemplateJSON(JSON.parse(jsonData)))
          : JSON.stringify(serializeTemplateJSON(jsonData)),
      }),
    },
  });

  return NextResponse.json({
    ...updated,
    formats: JSON.parse(updated.formats) as string[],
    jsonData: normalizeTemplateJSON(JSON.parse(updated.jsonData)),
  });
}

// DELETE /api/templates/:id — propriétaire admin seulement
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }
  const { id } = await params;

  const existing = await prisma.template.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Template introuvable" }, { status: 404 });
  }

  // Les listings et renders conservent l'historique (templateId -> NULL via SetNull)
  await prisma.$transaction([
    prisma.templateAccess.deleteMany({ where: { templateId: id } }),
    prisma.template.delete({ where: { id } }),
  ]);

  return NextResponse.json({ success: true });
}


