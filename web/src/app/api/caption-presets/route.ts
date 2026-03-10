import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/caption-presets
 * Admin: all builtin presets.
 * User: only presets explicitly assigned via CaptionPresetAccess.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const isAdmin = session.user.role === "ADMIN";

  let presets;
  if (isAdmin) {
    // Admin sees all presets
    presets = await prisma.captionPreset.findMany({
      orderBy: [{ isBuiltin: "desc" }, { createdAt: "asc" }],
    });
  } else {
    // User sees only assigned presets
    const accesses = await prisma.captionPresetAccess.findMany({
      where: { userId: session.user.id },
      include: { preset: true },
    });
    presets = accesses.map((a) => a.preset);
  }

  return NextResponse.json(
    presets.map((p) => ({
      id: p.id,
      name: p.name,
      isBuiltin: p.isBuiltin,
      config: JSON.parse(p.config) as Record<string, unknown>,
      createdAt: p.createdAt.toISOString(),
    }))
  );
}

/**
 * POST /api/caption-presets
 * Admin only — creates or overwrites a preset.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const body = await req.json() as { name?: string; config?: unknown; isBuiltin?: boolean };
  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "Le nom est requis" }, { status: 400 });
  }
  if (!body.config || typeof body.config !== "object") {
    return NextResponse.json({ error: "Config invalide" }, { status: 400 });
  }
  const isBuiltin = body.isBuiltin === true;

  // Upsert : si l'user a déjà un preset avec ce nom, on l'écrase
  const existing = await prisma.captionPreset.findFirst({
    where: { userId: session.user.id, name },
  });

  let preset;
  if (existing) {
    preset = await prisma.captionPreset.update({
      where: { id: existing.id },
      data: { config: JSON.stringify(body.config), isBuiltin },
    });
  } else {
    preset = await prisma.captionPreset.create({
      data: {
        name,
        userId: session.user.id,
        isBuiltin,
        config: JSON.stringify(body.config),
      },
    });
  }

  return NextResponse.json({
    id: preset.id,
    name: preset.name,
    isBuiltin: preset.isBuiltin,
    config: JSON.parse(preset.config) as Record<string, unknown>,
    createdAt: preset.createdAt.toISOString(),
  });
}
