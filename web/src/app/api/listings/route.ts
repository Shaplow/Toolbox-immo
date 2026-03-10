import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { TemplateJSON, SchemaField } from "@/types/template";

// POST /api/listings
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { templateId, data } = body;

    if (!templateId) {
      return NextResponse.json({ error: "templateId requis" }, { status: 400 });
    }

    // Fetch template to get its schema
    const template = await prisma.template.findFirst({
      where: { id: templateId },
    });
    if (!template) {
      return NextResponse.json({ error: "Template introuvable" }, { status: 404 });
    }

    // Check access: owner, granted, or admin
    const { canAccessTemplate } = await import("@/lib/permissions");
    const ok = await canAccessTemplate(session.user.id, templateId as string, session.user.role ?? undefined);
    if (!ok) {
      return NextResponse.json({ error: "Accès refusé à ce template" }, { status: 403 });
    }

    const json = JSON.parse(template.jsonData) as TemplateJSON;
    const schema: SchemaField[] = json.schema ?? [];

    // Validate required fields as defined in the template schema
    const missing: string[] = [];
    for (const field of schema) {
      if (!field.required) continue;
      const val = (data as Record<string, unknown>)?.[field.key];
      if (val === undefined || val === null || val === "") {
        missing.push(field.label || field.key);
      }
    }
    if (missing.length > 0) {
      return NextResponse.json(
        { error: "Champs obligatoires manquants", missing },
        { status: 422 }
      );
    }

    const listing = await prisma.listing.create({
      data: {
        templateId,
        jsonData: JSON.stringify(data),
        userId: session.user.id,
      },
    });

    return NextResponse.json(listing, { status: 201 });
  } catch (err) {
    console.error("[POST /api/listings]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}

// GET /api/listings — liste les listings de l'utilisateur
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const listings = await prisma.listing.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: { template: { select: { name: true, client: true } } },
  });

  return NextResponse.json(
    listings.map((l) => ({
      ...l,
      jsonData: JSON.parse(l.jsonData),
    }))
  );
}
