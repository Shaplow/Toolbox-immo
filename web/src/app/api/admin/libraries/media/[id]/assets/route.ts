import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function adminOnly(role?: string) {
  return role !== "ADMIN";
}

type Params = { params: Promise<{ id: string }> };

// GET /api/admin/libraries/media/[id]/assets — liste les MediaAsset d'une bibliothèque
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id || adminOnly(session.user.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;
  let library;
  try {
    library = await prisma.mediaLibrary.findUnique({ where: { id } });
  } catch (err) {
    console.error(`[admin/libraries/media/${id}/assets] findUnique error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
  if (!library) {
    return NextResponse.json({ error: "Bibliothèque introuvable" }, { status: 404 });
  }

  try {
    const assets = await prisma.mediaAsset.findMany({
      where: { libraryId: id },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(assets);
  } catch (err) {
    console.error(`[admin/libraries/media/${id}/assets] findMany error:`, err);
    return NextResponse.json({ error: "Erreur serveur lors du chargement des assets" }, { status: 500 });
  }
}
