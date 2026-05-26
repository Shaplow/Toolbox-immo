import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

function adminOnly(role?: string) {
  return role !== "ADMIN";
}

type Params = { params: Promise<{ campaignId: string }> };

// DELETE /api/admin/libraries/data/campaigns/[campaignId] — supprime une campaign
export async function DELETE(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { campaignId } = await params;
  try {
    const campaign = await prisma.dataCampaign.findUnique({ where: { id: campaignId } });
    if (!campaign) {
      return NextResponse.json({ error: "Campaign introuvable" }, { status: 404 });
    }
    await prisma.dataCampaign.delete({ where: { id: campaignId } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[admin/libraries/data/campaigns/${campaignId}] DELETE error:`, err);
    return NextResponse.json({ error: "Erreur serveur lors de la suppression" }, { status: 500 });
  }
}

// PATCH /api/admin/libraries/data/campaigns/[campaignId] — active/désactive une campaign
// Corps : { isActive: boolean }
export async function PATCH(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { campaignId: campaignIdPatch } = await params;
  let campaign;
  try {
    campaign = await prisma.dataCampaign.findUnique({ where: { id: campaignIdPatch } });
  } catch (err) {
    console.error(`[admin/libraries/data/campaigns/${campaignIdPatch}] PATCH error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
  if (!campaign) {
    return NextResponse.json({ error: "Campaign introuvable" }, { status: 404 });
  }

  const body = await req.json() as { isActive?: boolean; usagePolicy?: string };

  const VALID_POLICIES = ["cycle", "cycle_per_account", "once_per_account", "once_global", "unlimited"];

  if (typeof body.isActive !== "boolean" && !body.usagePolicy) {
    return NextResponse.json({ error: "isActive (boolean) ou usagePolicy requis" }, { status: 400 });
  }

  const dataUpdate: Record<string, unknown> = {};
  if (typeof body.isActive === "boolean") dataUpdate.isActive = body.isActive;
  if (body.usagePolicy && VALID_POLICIES.includes(body.usagePolicy)) {
    dataUpdate.usagePolicy = body.usagePolicy;
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      // Si on active, désactiver toutes les autres campaigns de la même library
      if (body.isActive) {
        await tx.dataCampaign.updateMany({
          where: { libraryId: campaign.libraryId, id: { not: campaignIdPatch } },
          data: { isActive: false },
        });
      }
      return tx.dataCampaign.update({
        where: { id: campaignIdPatch },
        data: dataUpdate,
      });
    });
    return NextResponse.json(updated);
  } catch (err) {
    console.error(`[admin/libraries/data/campaigns/${campaignIdPatch}] PATCH transaction error:`, err);
    return NextResponse.json({ error: "Erreur serveur lors de la mise à jour" }, { status: 500 });
  }
}