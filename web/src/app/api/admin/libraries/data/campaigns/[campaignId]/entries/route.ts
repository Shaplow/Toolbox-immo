import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ campaignId: string }> };

// GET /api/admin/libraries/data/campaigns/[campaignId]/entries
// Query params: ?accountId= (optional) → returns per-account usageCount/lastUsedAt
export async function GET(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
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

// POST /api/admin/libraries/data/campaigns/[campaignId]/entries
// Crée une fiche manuellement (form structuré côté UI, alternative à l'import CSV).
// body: { setTag?: string | null, category?: string | null, fields: Record<string, string> }
export async function POST(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { campaignId } = await params;
  const body = await req.json() as { setTag?: string | null; category?: string | null; fields?: Record<string, string> };

  if (!body.fields || typeof body.fields !== "object") {
    return NextResponse.json({ error: "fields requis (objet clé/valeur)" }, { status: 400 });
  }

  try {
    const campaign = await prisma.dataCampaign.findUnique({ where: { id: campaignId } });
    if (!campaign) {
      return NextResponse.json({ error: "Campaign introuvable" }, { status: 404 });
    }

    const entry = await prisma.dataEntry.create({
      data: {
        campaignId,
        setTag: body.setTag?.trim() || null,
        category: body.category?.trim() || null,
        fields: JSON.stringify(body.fields),
      },
    });
    return NextResponse.json(entry, { status: 201 });
  } catch (err) {
    console.error(`[admin/libraries/data/campaigns/${campaignId}/entries] POST error:`, err);
    return NextResponse.json({ error: "Erreur serveur lors de la création" }, { status: 500 });
  }
}
