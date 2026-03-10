import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { emptyTemplate } from "@/types/template";

// GET /api/templates
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const isAdmin = session.user.role === "ADMIN";

  let templates;
  if (isAdmin) {
    // Admin voit toutes les templates
    templates = await prisma.template.findMany({
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, client: true, formats: true, createdAt: true, updatedAt: true },
    });
  } else {
    // User voit uniquement les templates qui lui ont été assignés
    const accesses = await prisma.templateAccess.findMany({
      where: { userId: session.user.id },
      include: {
        template: {
          select: { id: true, name: true, client: true, formats: true, createdAt: true, updatedAt: true },
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
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const { name = "Nouveau template", client = "", format = "A3_LANDSCAPE" } = body;

  const json = emptyTemplate();
  const { CANVAS_FORMATS, defaultCanvas } = await import("@/types/template");
  if (format in CANVAS_FORMATS) {
    json.canvas = defaultCanvas(format);
  }

  const template = await prisma.template.create({
    data: {
      name,
      client,
      formats: JSON.stringify([format]),
      jsonData: JSON.stringify(json),
      userId: session.user.id,
    },
  });

  return NextResponse.json({ ...template, formats: [format] }, { status: 201 });
}
