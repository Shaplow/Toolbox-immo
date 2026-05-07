import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function adminOnly(role?: string) {
  return role !== "ADMIN";
}

type Params = { params: Promise<{ campaignId: string; entryId: string }> };

// PATCH /api/admin/libraries/data/campaigns/[campaignId]/entries/[entryId]
// Champs acceptés : accessAccountIds, resetUsage, resetUsageForAccount
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id || adminOnly(session.user.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { entryId } = await params;
  const body = await req.json() as {
    accessAccountIds?: string[];
    resetUsage?: boolean;
    resetUsageForAccount?: string;
  };

  const hasAccessUpdate = Array.isArray(body.accessAccountIds);
  const hasReset = body.resetUsage === true;
  const hasResetForAccount =
    typeof body.resetUsageForAccount === "string" && body.resetUsageForAccount.length > 0;

  if (!hasAccessUpdate && !hasReset && !hasResetForAccount) {
    return NextResponse.json({ error: "Aucun champ à mettre à jour" }, { status: 400 });
  }

  const entry = await prisma.dataEntry.findUnique({ where: { id: entryId } });
  if (!entry) {
    return NextResponse.json({ error: "Entrée introuvable" }, { status: 404 });
  }

  try {
    const ops: Promise<unknown>[] = [];

    if (hasReset) {
      // Reset global counters + cycle flag
      ops.push(
        prisma.dataEntry.update({
          where: { id: entryId },
          data: { usageCount: 0, lastUsedAt: null, usedInCycle: false },
        }),
      );
      // Wipe all per-account usage records
      ops.push(prisma.dataEntryUsage.deleteMany({ where: { entryId } }));
    }

    if (hasResetForAccount) {
      // Wipe only the specified account's usage record
      ops.push(
        prisma.dataEntryUsage.deleteMany({
          where: { entryId, accountId: body.resetUsageForAccount },
        }),
      );
    }

    if (hasAccessUpdate) {
      // Replace all access entries atomically
      ops.push(
        prisma.$transaction([
          prisma.dataEntryAccess.deleteMany({ where: { entryId } }),
          ...(body.accessAccountIds!.length > 0
            ? [
                prisma.dataEntryAccess.createMany({
                  data: body.accessAccountIds!.map((accountId) => ({ entryId, accountId })),
                  skipDuplicates: true,
                }),
              ]
            : []),
        ]),
      );
    }

    await Promise.all(ops);

    const updated = await prisma.dataEntry.findUnique({
      where: { id: entryId },
      include: { accesses: { select: { accountId: true } } },
    });
    if (!updated) return NextResponse.json({ error: "Entrée introuvable" }, { status: 404 });

    const { accesses, ...rest } = updated;
    return NextResponse.json({ ...rest, accessAccountIds: accesses.map((a) => a.accountId) });
  } catch (err) {
    console.error(`[admin/libraries/data/campaigns/entries/${entryId}] PATCH error:`, err);
    return NextResponse.json({ error: "Erreur serveur lors de la mise à jour" }, { status: 500 });
  }
}
