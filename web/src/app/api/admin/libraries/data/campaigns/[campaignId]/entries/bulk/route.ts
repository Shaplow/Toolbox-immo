import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ campaignId: string }> };

// POST /api/admin/libraries/data/campaigns/[campaignId]/entries/bulk
// Applique en masse le contrôle d'accès sur plusieurs DataEntry.
// Body : { entryIds: string[], accessAction: "add" | "remove_all", accountId?: string, accountIds?: string[] }
export async function POST(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { campaignId } = await params;

  const body = await req.json() as {
    entryIds?: unknown;
    accessAction?: unknown;
    accountId?: unknown;
    accountIds?: unknown;
  };

  if (!Array.isArray(body.entryIds) || body.entryIds.length === 0) {
    return NextResponse.json({ error: "entryIds est requis et doit être un tableau non vide" }, { status: 400 });
  }

  const rawIds = body.entryIds as unknown[];
  const entryIds = rawIds.filter((id): id is string => typeof id === "string");
  if (entryIds.length === 0) {
    return NextResponse.json({ error: "entryIds invalides" }, { status: 400 });
  }
  if (entryIds.length !== rawIds.length) {
    return NextResponse.json(
      { error: `entryIds invalides : ${rawIds.length - entryIds.length} entrée(s) ne sont pas des chaînes de caractères` },
      { status: 400 },
    );
  }

  const accessAction = typeof body.accessAction === "string" ? body.accessAction : null;

  // Supporte soit accountId (legacy, 1 compte) soit accountIds (multi).
  const accessAccountIds: string[] = (() => {
    if (Array.isArray(body.accountIds)) {
      return body.accountIds.filter((s): s is string => typeof s === "string");
    }
    if (typeof body.accountId === "string") return [body.accountId];
    return [];
  })();

  if (accessAction !== "add" && accessAction !== "remove_all") {
    return NextResponse.json(
      { error: "accessAction doit être \"add\" ou \"remove_all\"" },
      { status: 400 },
    );
  }

  if (accessAction === "add" && accessAccountIds.length === 0) {
    return NextResponse.json({ error: "accountId (ou accountIds[]) requis pour l'action add" }, { status: 400 });
  }

  try {
    // Vérifier que les entries appartiennent bien à cette campagne.
    const count = await prisma.dataEntry.count({
      where: { id: { in: entryIds }, campaignId },
    });
    if (count !== entryIds.length) {
      return NextResponse.json(
        { error: "Certaines entrées n'appartiennent pas à cette campagne" },
        { status: 400 },
      );
    }

    let updated = 0;

    await prisma.$transaction(async (tx) => {
      if (accessAction === "add") {
        // Cross-product : 1 row par (entryId, accountId) sélectionné.
        const rows = entryIds.flatMap((entryId) =>
          accessAccountIds.map((accountId) => ({ entryId, accountId })),
        );
        const result = await tx.dataEntryAccess.createMany({
          data: rows,
          skipDuplicates: true,
        });
        updated = result.count;
      } else {
        // remove_all : retire tous les accès des entries sélectionnées.
        // Si accountId fourni, retire seulement pour ce compte.
        const result = await tx.dataEntryAccess.deleteMany({
          where: {
            entryId: { in: entryIds },
            ...(accessAccountIds.length > 0 ? { accountId: { in: accessAccountIds } } : {}),
          },
        });
        updated = result.count;
      }
    });

    return NextResponse.json({ updated });
  } catch (err) {
    console.error(`[admin/libraries/data/campaigns/${campaignId}/entries/bulk] POST error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
