import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function adminOnly(role?: string) {
  return role !== "ADMIN";
}

type Params = { params: Promise<{ campaignId: string }> };

/**
 * POST /api/admin/libraries/data/campaigns/[campaignId]/reset
 *
 * Remet usedInCycle = false sur toutes les DataEntry de la campaign.
 * Opération destructive — irréversible.
 */
export async function POST(_req: NextRequest, { params }: Params) {
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

    const { count } = await prisma.$transaction(async (tx) => {
      const result = await tx.dataEntry.updateMany({
        where: { campaignId },
        data: { usedInCycle: false },
      });
      await tx.dataCampaign.update({
        where: { id: campaignId },
        data: { cycleResetAt: new Date() },
      });
      return result;
    });

    return NextResponse.json({ reset: count });
  } catch (err) {
    console.error(`[admin/libraries/data/campaigns/${campaignId}/reset] error:`, err);
    return NextResponse.json({ error: "Erreur serveur lors du reset" }, { status: 500 });
  }
}
