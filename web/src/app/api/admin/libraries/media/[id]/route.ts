import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { deleteFromR2, r2Configured } from "@/lib/r2";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/admin/libraries/media/[id] — met à jour une MediaLibrary (name, description, setSequence, tags)
export async function PATCH(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json() as { name?: string; description?: string; tags?: string[]; setSequence?: string[]; rotationScope?: string; rotationMode?: string | null; metadataSchema?: { key: string; label: string; type: string }[]; maxUsageCount?: number | null };

  const data: Record<string, unknown> = {};
  if (body.name?.trim()) data.name = body.name.trim();
  if (body.description !== undefined) data.description = body.description?.trim() ?? null;
  if (Array.isArray(body.tags)) data.tags = JSON.stringify(body.tags);
  if (Array.isArray(body.setSequence)) data.setSequence = JSON.stringify(body.setSequence);
  if (body.rotationScope === "per_account" || body.rotationScope === "shared") {
    data.rotationScope = body.rotationScope;
  }
  // rotationMode : "auto" | "override" | "none" | null (back-compat).
  if (body.rotationMode !== undefined) {
    if (body.rotationMode === null || body.rotationMode === "auto" || body.rotationMode === "override" || body.rotationMode === "none") {
      data.rotationMode = body.rotationMode;
    } else {
      return NextResponse.json({ error: "rotationMode doit être 'auto', 'override', 'none' ou null" }, { status: 400 });
    }
  }
  // Burn-once : maxUsageCount nullable, >= 1 si défini. null = rotation infinie.
  if (body.maxUsageCount !== undefined) {
    if (body.maxUsageCount === null) {
      data.maxUsageCount = null;
    } else if (Number.isInteger(body.maxUsageCount) && body.maxUsageCount >= 1) {
      data.maxUsageCount = body.maxUsageCount;
    } else {
      return NextResponse.json({ error: "maxUsageCount doit être null ou un entier ≥ 1" }, { status: 400 });
    }
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
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
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

  // Supprimer les fichiers R2 en premier (ignoré en dev sans config R2).
  // Parallèle via Promise.allSettled : si certains échouent, on stoppe l'opération
  // mais les déjà-supprimés ne sont pas réessayés. `deleteFromR2` est idempotent
  // (NoSuchKey traité comme succès par S3), donc un retry par l'admin est safe.
  if (r2Configured()) {
    const results = await Promise.allSettled(
      library.assets.map((asset) => deleteFromR2(asset.r2Key))
    );
    const r2Errors = results
      .map((r, i) => (r.status === "rejected" ? library.assets[i].r2Key : null))
      .filter((k): k is string => k !== null);
    if (r2Errors.length > 0) {
      r2Errors.forEach((key) =>
        console.error(`[admin/libraries/media] R2 delete failed for ${key}`)
      );
      return NextResponse.json(
        {
          error: `Échec suppression R2 pour ${r2Errors.length} fichier(s) sur ${library.assets.length}. Réessayez (les suppressions déjà réalisées sont idempotentes).`,
        },
        { status: 500 }
      );
    }
  }

  try {
    await prisma.mediaLibrary.delete({ where: { id } });
  } catch (err) {
    console.error(`[admin/libraries/media/${id}] delete error:`, err);
    return NextResponse.json({ error: "Erreur lors de la suppression en base" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
