import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function adminOnly(role?: string) {
  return role !== "ADMIN";
}

// GET /api/admin/libraries/media — liste les MediaLibrary (+ asset count)
// Supporte ?type=video|audio pour filtrer. Accessible aux admins seulement.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || adminOnly(session.user.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const url = new URL(req.url);
  const typeFilter = url.searchParams.get("type");

  try {
    const libraries = await prisma.mediaLibrary.findMany({
      where: typeFilter ? { type: typeFilter } : undefined,
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { assets: true } } },
    });
    return NextResponse.json(libraries);
  } catch (err) {
    console.error("[admin/libraries/media] GET error:", err);
    return NextResponse.json({ error: "Erreur serveur lors du chargement des bibliothèques" }, { status: 500 });
  }
}

// POST /api/admin/libraries/media — crée une MediaLibrary
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || adminOnly(session.user.role)) {
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
