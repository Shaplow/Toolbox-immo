import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deleteFromR2, r2Configured } from "@/lib/r2";

function adminOnly(role?: string) {
  return role !== "ADMIN";
}

type Params = { params: Promise<{ id: string }> };

// PATCH /api/admin/libraries/media/[id] — met à jour une MediaLibrary (name, description, setSequence, tags)
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id || adminOnly(session.user.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json() as { name?: string; description?: string; tags?: string[]; setSequence?: string[]; rotationScope?: string; metadataSchema?: { key: string; label: string; type: string }[] };

  const data: Record<string, unknown> = {};
  if (body.name?.trim()) data.name = body.name.trim();
  if (body.description !== undefined) data.description = body.description?.trim() ?? null;
  if (Array.isArray(body.tags)) data.tags = JSON.stringify(body.tags);
  if (Array.isArray(body.setSequence)) data.setSequence = JSON.stringify(body.setSequence);
  if (body.rotationScope === "per_account" || body.rotationScope === "shared") {
    data.rotationScope = body.rotationScope;
  }
  if (Array.isArray(body.metadataSchema)) {
    const metaKeys = body.metadataSchema.map((f) => (f.key ?? "").trim());
    if (metaKeys.some((k) => !k)) {
      return NextResponse.json({ error: "Toutes les clés de champs de métadonnées doivent être non vides" }, { status: 400 });
    }
    if (new Set(metaKeys).size !== metaKeys.length) {
      return NextResponse.json({ error: "Les clés de champs de métadonnées doivent être uniques" }, { status: 400 });
    }
    data.metadataSchema = JSON.stringify(body.metadataSchema);
  }

  try {
    const library = await prisma.mediaLibrary.update({ where: { id }, data });
    return NextResponse.json(library);
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2025") {
      return NextResponse.json({ error: "Bibliothèque introuvable" }, { status: 404 });
    }
    console.error(`[admin/libraries/media/${id}] PATCH error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

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

  // Supprimer les fichiers R2 en premier (ignoré en dev sans config R2)
  if (r2Configured()) {
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
  }

  await prisma.mediaLibrary.delete({ where: { id } }).catch((err) => {
    console.error(`[admin/libraries/media/${id}] delete error:`, err);
  });
  return NextResponse.json({ ok: true });
}
