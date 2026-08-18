import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { canViewMediaLibrary, canManageMediaLibraries } from "@/lib/permissions/mediaLibrary";
import { prisma } from "@/lib/prisma";
import { normalizeStringArrayInput } from "@/lib/apiInput";

// GET /api/admin/libraries/media — liste les MediaLibrary (+ asset count)
// Supporte ?type=video|audio pour filtrer. Lecture : tous les rôles médiathèque
// (le MONTEUR consulte et télécharge). La création (POST) reste ADMIN.
export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  if (!canViewMediaLibrary(auth.ctx.effectiveUser.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const url = new URL(req.url);
  const typeFilter = url.searchParams.get("type");

  try {
    const libraries = await prisma.mediaLibrary.findMany({
      where: typeFilter ? { type: typeFilter } : undefined,
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { assets: true } },
        // Cover unique de la LibraryCard (MediaLibrariesPanel) — 1er asset
        // vidéo le plus récent. Les libs audio n'ont pas de mimeType
        // "video/*" donc ne remontent rien ici (fallback icône côté client).
        assets: {
          where: { disabled: false, mimeType: { startsWith: "video/" } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, url: true, mimeType: true },
        },
      },
    });
    // Renomme `assets` en `previewAssets` côté client pour éviter la confusion
    // avec la prop `assets` du MediaAssetsPanel (qui charge tous les assets).
    const enriched = libraries.map(({ assets, ...lib }) => ({
      ...lib,
      previewAssets: assets,
    }));
    return NextResponse.json(enriched);
  } catch (err) {
    console.error("[admin/libraries/media] GET error:", err);
    return NextResponse.json({ error: "Erreur serveur lors du chargement des bibliothèques" }, { status: 500 });
  }
}

// POST /api/admin/libraries/media — crée une MediaLibrary
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  if (!canManageMediaLibraries(auth.ctx.effectiveUser.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const body = await req.json() as { name?: string; type?: string; tags?: string[] | string; description?: string };
  const { name, type, description } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "Le nom est requis" }, { status: 400 });
  }
  if (type !== "video" && type !== "audio") {
    return NextResponse.json({ error: "Le type doit être 'video' ou 'audio'" }, { status: 400 });
  }
  // Même normalisation qu'au PATCH : sans elle, une string JSON serait
  // double-encodée par le `JSON.stringify` ci-dessous.
  const parsedTags = normalizeStringArrayInput(body.tags, "tags");
  if (!parsedTags.ok) return NextResponse.json({ error: parsedTags.error }, { status: 400 });
  const tags = parsedTags.value ?? [];

  try {
    const library = await prisma.mediaLibrary.create({
      data: {
        name: name.trim(),
        type,
        tags: JSON.stringify(tags),
        description: description?.trim() ?? null,
      },
    });
    return NextResponse.json(library, { status: 201 });
  } catch (err) {
    console.error("[admin/libraries/media] POST error:", err);
    return NextResponse.json({ error: "Erreur serveur lors de la création" }, { status: 500 });
  }
}
