import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireUser } from "@/lib/api/requireAuth";

/**
 * GET /api/caption-presets
 * Admin (not impersonating): all presets.
 * User or impersonating admin: only presets explicitly assigned via CaptionPresetAccess.
 */
export async function GET() {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;

  const isAdmin = userContext.canAdminBypass;
  const effectiveUserId = userContext.effectiveUser.id;

  let presets;
  if (isAdmin) {
    // Real admin view — sees all presets
    presets = await prisma.captionPreset.findMany({
      orderBy: [{ isBuiltin: "desc" }, { createdAt: "asc" }],
    });
  } else {
    // Regular user or impersonating admin — only assigned presets
    const accesses = await prisma.captionPresetAccess.findMany({
      where: { userId: effectiveUserId },
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
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;

  // POST est admin-only. Le preset est rattaché à l'admin réel (actualUser),
  // pas à l'identité impersonnée — sinon un admin qui impersonne un CM
  // créerait des presets sous le compte du CM. Sémantique audit.
  const ownerUserId = userContext.actualUser.id;

  const body = await req.json() as { name?: string; config?: unknown; isBuiltin?: boolean };
  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "Le nom est requis" }, { status: 400 });
  }
  if (!body.config || typeof body.config !== "object") {
    return NextResponse.json({ error: "Config invalide" }, { status: 400 });
  }
  const isBuiltin = body.isBuiltin === true;

  // Upsert : si l'admin a déjà un preset avec ce nom, on l'écrase
  const existing = await prisma.captionPreset.findFirst({
    where: { userId: ownerUserId, name },
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
        userId: ownerUserId,
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
