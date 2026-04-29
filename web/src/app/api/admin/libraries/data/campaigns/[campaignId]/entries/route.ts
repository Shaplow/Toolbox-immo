import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function adminOnly(role?: string) {
  return role !== "ADMIN";
}

type Params = { params: Promise<{ campaignId: string }> };

// GET /api/admin/libraries/data/campaigns/[campaignId]/entries
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id || adminOnly(session.user.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { campaignId } = await params;
  try {
    const campaign = await prisma.dataCampaign.findUnique({ where: { id: campaignId } });
    if (!campaign) {
      return NextResponse.json({ error: "Campaign introuvable" }, { status: 404 });
    }

    const entries = await prisma.dataEntry.findMany({
      where: { campaignId },
      orderBy: [{ usedInCycle: "asc" }, { usageCount: "asc" }, { createdAt: "asc" }],
    });
    return NextResponse.json(entries);
  } catch (err) {
    console.error(`[admin/libraries/data/campaigns/${campaignId}/entries] GET error:`, err);
    return NextResponse.json({ error: "Erreur serveur lors du chargement" }, { status: 500 });
  }
}
