import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deleteFromR2 } from "@/lib/r2";

function adminOnly(role?: string) {
  return role !== "ADMIN";
}

type Params = { params: Promise<{ id: string }> };

// DELETE /api/admin/libraries/media/[id] — supprime une MediaLibrary (cascade assets)
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id || adminOnly(session.user.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;
  let library;
  try {
    library = await prisma.mediaLibrary.findUnique({
      where: { id },
      include: { assets: { select: { r2Key: true } } },
    });
  } catch (err) {
    console.error(`[admin/libraries/media/${id}] findUnique error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
  if (!library) {
    return NextResponse.json({ error: "Bibliothèque introuvable" }, { status: 404 });
  }

  // Supprimer les fichiers R2 en premier
  const r2Errors: string[] = [];
  for (const asset of library.assets) {
    try {
      await deleteFromR2(asset.r2Key);
    } catch (err) {
      r2Errors.push(asset.r2Key);
      console.error(`[admin/libraries/media] R2 delete failed for ${asset.r2Key}:`, err);
    }
  }
  if (r2Errors.length > 0) {
    return NextResponse.json(
      { error: `Échec suppression R2 pour ${r2Errors.length} fichier(s). Réessayez.` },
      { status: 500 }
    );
  }

  await prisma.mediaLibrary.delete({ where: { id } }).catch((err) => {
    console.error(`[admin/libraries/media/${id}] delete error:`, err);
  });
  return NextResponse.json({ ok: true });
}
