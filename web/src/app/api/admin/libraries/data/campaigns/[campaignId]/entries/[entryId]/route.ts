import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ campaignId: string; entryId: string }> };

// PATCH /api/admin/libraries/data/campaigns/[campaignId]/entries/[entryId]
// Champs acceptés : fields, setTag, category, accessAccountIds, resetUsage, resetUsageForAccount
export async function PATCH(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { entryId } = await params;
  const body = await req.json() as {
    fields?: Record<string, string>;
    setTag?: string | null;
    category?: string | null;
    accessAccountIds?: string[];
    resetUsage?: boolean;
    resetUsageForAccount?: string;
  };

  const hasFieldsUpdate =
    body.fields !== undefined ||
    body.setTag !== undefined ||
    body.category !== undefined;
  const hasAccessUpdate = Array.isArray(body.accessAccountIds);
  const hasReset = body.resetUsage === true;
  const hasResetForAccount =
    typeof body.resetUsageForAccount === "string" && body.resetUsageForAccount.length > 0;

  if (!hasFieldsUpdate && !hasAccessUpdate && !hasReset && !hasResetForAccount) {
    return NextResponse.json({ error: "Aucun champ à mettre à jour" }, { status: 400 });
  }

  const entry = await prisma.dataEntry.findUnique({ where: { id: entryId } });
  if (!entry) {
    return NextResponse.json({ error: "Entrée introuvable" }, { status: 404 });
  }

  // Toutes les sous-opérations (fields, reset global+per-account, reset par
  // compte, remplacement access) dans une seule transaction. Sans ça, un
  // succès partiel laissait l'entry à moitié mise à jour (ex: fields écrits
  // mais ancienne access-list conservée, ou usage reset sans access update)
  // sans rollback — finding library-10.
  try {
    await prisma.$transaction(async (tx) => {
      if (hasFieldsUpdate) {
        const dataUpdate: { fields?: string; setTag?: string | null; category?: string | null } = {};
        if (body.fields !== undefined) {
          dataUpdate.fields = JSON.stringify(body.fields);
        }
        if (body.setTag !== undefined) {
          dataUpdate.setTag = body.setTag ?? null;
        }
        if (body.category !== undefined) {
          dataUpdate.category = body.category ?? null;
        }
        await tx.dataEntry.update({ where: { id: entryId }, data: dataUpdate });
      }

      if (hasReset) {
        // Reset global counters + cycle flag
        await tx.dataEntry.update({
          where: { id: entryId },
          data: { usageCount: 0, lastUsedAt: null, usedInCycle: false },
        });
        // Wipe all per-account usage records
        await tx.dataEntryUsage.deleteMany({ where: { entryId } });
      }

      if (hasResetForAccount) {
        // Wipe only the specified account's usage record
        await tx.dataEntryUsage.deleteMany({
          where: { entryId, accountId: body.resetUsageForAccount },
        });
      }

      if (hasAccessUpdate) {
        // Replace all access entries dans la même tx — pas de $transaction
        // imbriqué (anti-pattern interactive tx Prisma).
        await tx.dataEntryAccess.deleteMany({ where: { entryId } });
        if (body.accessAccountIds && body.accessAccountIds.length > 0) {
          await tx.dataEntryAccess.createMany({
            data: body.accessAccountIds.map((accountId) => ({ entryId, accountId })),
            skipDuplicates: true,
          });
        }
      }
    });

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

// DELETE /api/admin/libraries/data/campaigns/[campaignId]/entries/[entryId]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { entryId } = await params;

  const entry = await prisma.dataEntry.findUnique({ where: { id: entryId }, select: { id: true } });
  if (!entry) {
    return NextResponse.json({ error: "Entrée introuvable" }, { status: 404 });
  }

  try {
    await prisma.dataEntry.delete({ where: { id: entryId } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[admin/libraries/data/campaigns/entries/${entryId}] DELETE error:`, err);
    return NextResponse.json({ error: "Erreur serveur lors de la suppression" }, { status: 500 });
  }
}
