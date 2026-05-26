import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ libraryId: string }> };

// GET /api/libraries/[libraryId]/assets
// Auth-gated (no admin required) — returns public asset list for a library.
// Used by the generation form library picker for all authenticated users.
export async function GET(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { libraryId } = await params;

  const library = await prisma.mediaLibrary.findUnique({
    where: { id: libraryId },
    select: { id: true },
  });
  if (!library) {
    return NextResponse.json({ error: "Bibliothèque introuvable" }, { status: 404 });
  }

  // Optional tag filter — case-insensitive
  const tag = req.nextUrl.searchParams.get("tag")?.trim().toLowerCase() ?? "";
  // Optional accountId — when present, filters to accessible assets and returns per-account stats
  const accountId = req.nextUrl.searchParams.get("accountId")?.trim() || null;

  const tagWhere = tag ? { tags: { contains: `"${tag}"`, mode: "insensitive" as const } } : {};

  // Access filter: mirrors the resolver logic in contentLibraryResolver.ts
  //   with accountId    → global (no restrictions) OR restricted-to-me
  //   without accountId → global only (no MediaAssetAccess rows)
  const accessWhere = accountId
    ? { OR: [{ accesses: { none: {} } }, { accesses: { some: { accountId } } }] }
    : { accesses: { none: {} } };

  if (accountId) {
    // Per-account path: fetch with per-account usage stats, sort in JS (can't orderBy relation)
    const rawAssets = await prisma.mediaAsset.findMany({
      where: { libraryId, ...tagWhere, ...accessWhere },
      select: {
        id: true,
        filename: true,
        url: true,
        mimeType: true,
        duration: true,
        usageCount: true,
        lastUsedAt: true,
        usages: {
          where: { accountId },
          select: { usageCount: true, lastUsedAt: true },
          take: 1,
        },
      },
    });

    const assets = rawAssets
      .map((a) => ({
        id: a.id,
        filename: a.filename,
        url: a.url,
        mimeType: a.mimeType,
        duration: a.duration,
        // Prefer per-account stats; fall back to global when no usage row exists yet
        usageCount: a.usages[0]?.usageCount ?? 0,
        lastUsedAt: a.usages[0]?.lastUsedAt ?? null,
      }))
      .sort((a, b) => {
        if (a.usageCount !== b.usageCount) return a.usageCount - b.usageCount;
        const aTime = a.lastUsedAt ? (a.lastUsedAt as unknown as Date).getTime() : -Infinity;
        const bTime = b.lastUsedAt ? (b.lastUsedAt as unknown as Date).getTime() : -Infinity;
        return aTime - bTime;
      });

    return NextResponse.json(assets);
  }

  // Global path: no accountId — use global counters, sort by usageCount ASC (matches least_used resolver)
  const assets = await prisma.mediaAsset.findMany({
    where: { libraryId, ...tagWhere, ...accessWhere },
    orderBy: [{ usageCount: "asc" }, { lastUsedAt: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      filename: true,
      url: true,
      mimeType: true,
      duration: true,
      usageCount: true,
      lastUsedAt: true,
    },
  });

  return NextResponse.json(assets);
}
