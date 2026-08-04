import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { canViewMediaLibrary, canManageMediaLibraries } from "@/lib/permissions/mediaLibrary";
import { prisma } from "@/lib/prisma";

// GET /api/admin/libraries/media — liste les MediaLibrary (+ asset count)
// Supporte ?type=video|audio pour filtrer. Lecture : tous les rôles médiathèque
// (le MONTEUR consulte et télécharge). La création (POST) reste ADMIN.
export async function GET(req: NextRequest) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !canViewMediaLibrary(userContext.effectiveUser.role)) {
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
        // Phase 4 médiathèque — 4 assets les plus récents pour preview thumbs
        // sur les LibraryCards (grille 2x2). Limité à 4 + champs minimaux pour
        // garder la payload légère.
        assets: {
          where: { disabled: false },
          orderBy: { createdAt: "desc" },
          take: 4,
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
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !canManageMediaLibraries(userContext.effectiveUser.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const body = await req.json() as { name?: string; type?: string; tags?: string[]; description?: string; setSequence?: string[] };
  const { name, type, tags = [], description, setSequence = [] } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "Le nom est requis" }, { status: 400 });
  }
  if (type !== "video" && type !== "audio") {
    return NextResponse.json({ error: "Le type doit être 'video' ou 'audio'" }, { status: 400 });
  }

  try {
    const library = await prisma.mediaLibrary.create({
      data: {
        name: name.trim(),
        type,
        tags: JSON.stringify(tags),
        description: description?.trim() ?? null,
        setSequence: JSON.stringify(setSequence),
      },
    });
    return NextResponse.json(library, { status: 201 });
  } catch (err) {
    console.error("[admin/libraries/media] POST error:", err);
    return NextResponse.json({ error: "Erreur serveur lors de la création" }, { status: 500 });
  }
}
