import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

function adminOnly(role?: string) {
  return role !== "ADMIN";
}

type Params = { params: Promise<{ id: string }> };

// GET /api/admin/libraries/media/[id]/assets — liste les MediaAsset d'une bibliothèque
export async function GET(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
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

  const accountId = _req.nextUrl.searchParams.get("accountId") ?? undefined;

  try {
    const [assets, accountUsages] = await Promise.all([
      prisma.mediaAsset.findMany({
        where: { libraryId: id },
        orderBy: { createdAt: "desc" },
        include: {
          accesses: { select: { accountId: true } },
          editJobs: {
            where: { status: { in: ["pending", "processing"] } },
            select: { id: true, status: true },
            take: 1,
          },
        },
      }),
      accountId
        ? prisma.mediaAssetUsage.findMany({
            where: { accountId, asset: { libraryId: id } },
            select: { assetId: true, lastUsedAt: true, usageCount: true },
          })
        : Promise.resolve([]),
    ]);

    const usageMap = new Map(accountUsages.map((u) => [u.assetId, u]));

    const result = assets.map((a) => {
      const { accesses, editJobs, ...rest } = a;
      const accountUsage = accountId ? (usageMap.get(a.id) ?? null) : undefined;
      return {
        ...rest,
        accessAccountIds: accesses.map((acc) => acc.accountId),
        lastUsedAt: accountId ? (accountUsage?.lastUsedAt ?? null) : a.lastUsedAt,
        usageCount: accountId ? (accountUsage?.usageCount ?? 0) : a.usageCount,
        pendingEditJob: editJobs[0] ?? null,
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error(`[admin/libraries/media/${id}/assets] findMany error:`, err);
    return NextResponse.json({ error: "Erreur serveur lors du chargement des assets" }, { status: 500 });
  }
}
