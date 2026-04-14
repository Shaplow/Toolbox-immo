import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/derush-presets
 * Admin : tous les presets (builtin + personnels).
 * User  : uniquement les presets auxquels il a accès via DerushPresetAccess.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const isAdmin = session.user.role === "ADMIN";

  if (isAdmin) {
    const presets = await prisma.derushPreset.findMany({
      orderBy: [{ isBuiltin: "desc" }, { createdAt: "asc" }],
    });
    return NextResponse.json(presets.map(formatPreset));
  }

  const accesses = await prisma.derushPresetAccess.findMany({
    where: { userId: session.user.id },
    include: { preset: true },
  });
  return NextResponse.json(accesses.map((a) => formatPreset(a.preset)));
}

/**
 * POST /api/derush-presets
 * Admin uniquement — crée ou écrase un preset.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const body = await req.json() as {
    name?: string;
    config?: unknown;
    isBuiltin?: boolean;
    analysisMode?: string;
  };

  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "Le nom est requis" }, { status: 400 });
  }
  if (!body.config || typeof body.config !== "object") {
    return NextResponse.json({ error: "Config invalide" }, { status: 400 });
  }

  const analysisMode = body.analysisMode === "transcription" ? "transcription" : "vision";
  const isBuiltin = body.isBuiltin === true;

  const existing = await prisma.derushPreset.findFirst({
    where: { userId: session.user.id, name },
  });

  let preset;
  if (existing) {
    preset = await prisma.derushPreset.update({
      where: { id: existing.id },
      data: { config: JSON.stringify(body.config), isBuiltin, analysisMode },
    });
  } else {
    preset = await prisma.derushPreset.create({
      data: {
        name,
        userId: session.user.id,
        isBuiltin,
        analysisMode,
        config: JSON.stringify(body.config),
      },
    });
  }

  return NextResponse.json(formatPreset(preset));
}

function formatPreset(preset: {
  id: string;
  name: string;
  isBuiltin: boolean;
  analysisMode: string;
  config: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: preset.id,
    name: preset.name,
    isBuiltin: preset.isBuiltin,
    analysisMode: preset.analysisMode,
    config: JSON.parse(preset.config) as Record<string, unknown>,
    createdAt: preset.createdAt.toISOString(),
    updatedAt: preset.updatedAt.toISOString(),
  };
}
