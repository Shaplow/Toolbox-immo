import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

function adminOnly(role?: string) {
  return role !== "ADMIN";
}

type Params = { params: Promise<{ campaignId: string }> };

/**
 * POST /api/admin/libraries/data/campaigns/[campaignId]/reset
 *
 * Reset global (sans body) : remet usedInCycle = false sur toutes les DataEntry.
 * Reset par compte (body { accountId }) : supprime les DataEntryUsage du compte pour
 * les entrées de la campagne (utilisé avec les policies cycle_per_account / once_per_account).
 * Opération destructive — irréversible.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { campaignId } = await params;

  let accountId: string | undefined;
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await req.json() as { accountId?: string };
    accountId = body.accountId;
  }

  try {
    const campaign = await prisma.dataCampaign.findUnique({ where: { id: campaignId } });
    if (!campaign) {
      return NextResponse.json({ error: "Campaign introuvable" }, { status: 404 });
    }

    // Per-account reset: supprime les DataEntryUsage du compte pour cette campagne
    if (accountId) {
      const entryIds = (
        await prisma.dataEntry.findMany({ where: { campaignId }, select: { id: true } })
      ).map((e) => e.id);

      const { count } = await prisma.dataEntryUsage.deleteMany({
        where: { accountId, entryId: { in: entryIds } },
      });
      return NextResponse.json({ reset: count });
    }

    // Global reset: remet usedInCycle = false + supprime tous les DataEntryUsage + maj cycleResetAt
    // Pour les policies "cycle" / "once_global" : usedInCycle est le sentinel → reset suffisant.
    // Pour les policies "cycle_per_account" / "once_per_account" : c'est DataEntryUsage.usageCount
    // qui détermine l'éligibilité → il faut supprimer les lignes pour vraiment repartir à zéro.
    const { count } = await prisma.$transaction(async (tx) => {
      const entryIds = (
        await tx.dataEntry.findMany({ where: { campaignId }, select: { id: true } })
      ).map((e) => e.id);

      const result = await tx.dataEntry.updateMany({
        where: { campaignId },
        data: { usedInCycle: false },
      });
      // Purge per-account usage so "once_per_account" / "cycle_per_account" policies
      // redémarrent vraiment à zéro pour tous les comptes.
      if (entryIds.length > 0) {
        await tx.dataEntryUsage.deleteMany({ where: { entryId: { in: entryIds } } });
      }
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
