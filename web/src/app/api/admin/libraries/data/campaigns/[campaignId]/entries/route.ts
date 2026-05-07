import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function adminOnly(role?: string) {
  return role !== "ADMIN";
}

type Params = { params: Promise<{ campaignId: string }> };

// GET /api/admin/libraries/data/campaigns/[campaignId]/entries
// Query params: ?accountId= (optional) → returns per-account usageCount/lastUsedAt
export async function GET(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id || adminOnly(session.user.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { campaignId } = await params;
  const accountId = req.nextUrl.searchParams.get("accountId") ?? undefined;

  try {
    const campaign = await prisma.dataCampaign.findUnique({ where: { id: campaignId } });
    if (!campaign) {
      return NextResponse.json({ error: "Campaign introuvable" }, { status: 404 });
    }

    const entries = await prisma.dataEntry.findMany({
      where: { campaignId },
      include: {
        accesses: { select: { accountId: true } },
        usages: accountId
          ? { where: { accountId }, select: { usageCount: true, lastUsedAt: true } }
          : false,
      },
      orderBy: [{ usedInCycle: "asc" }, { usageCount: "asc" }, { createdAt: "asc" }],
    });

    const result = entries.map((e) => {
      const { accesses, usages, ...rest } = e;
      const accessAccountIds = accesses.map((a) => a.accountId);
      const perAccount = Array.isArray(usages) && usages.length > 0 ? usages[0] : null;
      return {
        ...rest,
        accessAccountIds,
        usageCount: perAccount ? perAccount.usageCount : rest.usageCount,
        lastUsedAt: perAccount ? perAccount.lastUsedAt?.toISOString() ?? null : rest.lastUsedAt,
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error(`[admin/libraries/data/campaigns/${campaignId}/entries] GET error:`, err);
    return NextResponse.json({ error: "Erreur serveur lors du chargement" }, { status: 500 });
  }
}
