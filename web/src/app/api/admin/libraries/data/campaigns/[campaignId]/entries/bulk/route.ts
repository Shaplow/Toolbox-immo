import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import {
  isBulkParseError,
  parseBulkAccessBody,
} from "@/lib/admin/libraryBulkHelpers";

type Params = { params: Promise<{ campaignId: string }> };

// PATCH /api/admin/libraries/data/campaigns/[campaignId]/entries/bulk
// Applique en masse le contrôle d'accès sur plusieurs DataEntry.
// Body : { entryIds: string[], accessAction: "add" | "remove_all", accountId?: string, accountIds?: string[] }
//
// Note : la méthode HTTP a été migrée POST → PATCH (alignement avec la route
// bulk media qui utilise déjà PATCH pour la même sémantique partial-update).
export async function PATCH(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { campaignId } = await params;

  const body = (await req.json()) as Record<string, unknown>;

  const parsed = parseBulkAccessBody(body, "entryIds", { requireAction: true });
  if (isBulkParseError(parsed)) {
    return NextResponse.json({ error: parsed.message }, { status: parsed.status });
  }
  const { ids: entryIds, action: accessAction, accountIds: accessAccountIds } = parsed;

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
    console.error(`[admin/libraries/data/campaigns/${campaignId}/entries/bulk] PATCH error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
