/**
 * GET  /api/derush/formats  — liste les formats builtins + ceux de l'utilisateur
 * POST /api/derush/formats  — crée un format personnalisé
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────────────────────────────────────

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const formats = await prisma.derushFormat.findMany({
    where: {
      OR: [
        { isBuiltin: true },
        { userId: session.user.id },
      ],
    },
    orderBy: [
      { isBuiltin: "desc" },
      { createdAt: "asc" },
    ],
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      contextPrompt: true,
      silenceThreshold: true,
      exportMode: true,
      isBuiltin: true,
      userId: true,
      createdAt: true,
    },
  });

  return NextResponse.json(formats);
}

// ─────────────────────────────────────────────────────────────────────────────

function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 60);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  let body: {
    name?: string;
    description?: string;
    contextPrompt?: string;
    silenceThreshold?: number;
    exportMode?: string;
  };
  try {
    body = await req.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  if (!body.name || typeof body.name !== "string" || body.name.trim().length < 2) {
    return NextResponse.json({ error: "Le nom est requis (min 2 caractères)" }, { status: 400 });
  }

  const exportMode = body.exportMode === "qa_pair" ? "qa_pair" : "individual";
  const silenceThreshold =
    typeof body.silenceThreshold === "number" && body.silenceThreshold >= 0
      ? body.silenceThreshold
      : 1.5;

  // Generate a unique slug
  const baseSlug = slugify(body.name.trim());
  let slug = baseSlug;
  const existing = await prisma.derushFormat.findUnique({ where: { slug } });
  if (existing) {
    slug = `${baseSlug}_${Date.now().toString(36)}`;
  }

  const format = await prisma.derushFormat.create({
    data: {
      name: body.name.trim(),
      slug,
      description: (body.description ?? "").trim(),
      contextPrompt: (body.contextPrompt ?? "").trim(),
      silenceThreshold,
      exportMode,
      isBuiltin: false,
      userId: session.user.id,
    },
  });

  return NextResponse.json(format, { status: 201 });
}
