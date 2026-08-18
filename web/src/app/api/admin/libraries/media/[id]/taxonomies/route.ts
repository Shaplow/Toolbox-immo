import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { canViewMediaLibrary, canManageMediaLibraries } from "@/lib/permissions/mediaLibrary";
import { prisma } from "@/lib/prisma";
import { isReservedSetTag } from "@/lib/rotation/sentinels";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/admin/libraries/media/[id]/taxonomies
 * Retourne les Packs (Dossiers) / Tags utilisés dans la lib avec leur count.
 * Packs auto (`pack_<random>`) sont exclus de la liste publique des packs.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  if (!canViewMediaLibrary(auth.ctx.effectiveUser.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }
  const { id: libraryId } = await params;

  try {
    const assets = await prisma.mediaAsset.findMany({
      where: { libraryId },
      select: { setTag: true, tags: true },
    });

    const packMap = new Map<string, number>();
    const tagMap = new Map<string, number>();

    for (const a of assets) {
      if (a.setTag && !isReservedSetTag(a.setTag)) {
        packMap.set(a.setTag, (packMap.get(a.setTag) ?? 0) + 1);
      }
      try {
        const tags = JSON.parse(a.tags ?? "[]") as string[];
        for (const t of tags) {
          if (typeof t === "string" && t.trim()) {
            tagMap.set(t, (tagMap.get(t) ?? 0) + 1);
          }
        }
      } catch {
        /* asset.tags non-JSON, skip */
      }
    }

    const toSorted = (m: Map<string, number>) =>
      Array.from(m.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => a.value.localeCompare(b.value));

    return NextResponse.json({
      packs: toSorted(packMap),
      tags: toSorted(tagMap),
    });
  } catch (err) {
    console.error(`[admin/libraries/media/${libraryId}/taxonomies] GET error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/libraries/media/[id]/taxonomies?type=pack|tag&value=X
 * Détache la taxonomie de TOUS les assets concernés (cascade non-destructive).
 * - pack     : set setTag = null sur tous les assets avec ce setTag
 * - tag      : retire le tag du array tags[] de tous les assets qui le contiennent
 *
 * Les assets eux-mêmes ne sont jamais supprimés.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  if (!canManageMediaLibraries(auth.ctx.effectiveUser.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }
  const { id: libraryId } = await params;

  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const value = url.searchParams.get("value");

  if (!type || !value) {
    return NextResponse.json({ error: "Paramètres `type` et `value` requis" }, { status: 400 });
  }

  try {
    if (type === "pack") {
      const result = await prisma.mediaAsset.updateMany({
        where: { libraryId, setTag: value },
        data: { setTag: null },
      });
      return NextResponse.json({ detached: result.count });
    }

    if (type === "tag") {
      // Tags stockés en JSON string[]. Faut update individuellement.
      const assets = await prisma.mediaAsset.findMany({
        where: { libraryId },
        select: { id: true, tags: true },
      });
      const updates: Array<{ id: string; tags: string }> = [];
      for (const a of assets) {
        let tags: string[];
        try {
          tags = JSON.parse(a.tags ?? "[]") as string[];
        } catch {
          continue;
        }
        if (tags.includes(value)) {
          const next = tags.filter((t) => t !== value);
          updates.push({ id: a.id, tags: JSON.stringify(next) });
        }
      }
      await prisma.$transaction(
        updates.map((u) =>
          prisma.mediaAsset.update({ where: { id: u.id }, data: { tags: u.tags } }),
        ),
      );
      return NextResponse.json({ detached: updates.length });
    }

    return NextResponse.json({ error: "type doit être 'pack' ou 'tag'" }, { status: 400 });
  } catch (err) {
    console.error(`[admin/libraries/media/${libraryId}/taxonomies] DELETE error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
