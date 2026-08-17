import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string; entryId: string }> };

// PATCH /api/admin/libraries/data/[id]/entries/[entryId]
// Champs acceptés : fields, setTag, accessAccountIds, resetUsage, resetUsageForAccount.
// `category` n'est plus accepté (colonne dépréciée, plus lue).
export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  const { id: libraryId, entryId } = await params;
  const body = (await req.json()) as {
    fields?: Record<string, string>;
    setTag?: string | null;
    accessAccountIds?: string[];
    resetUsage?: boolean;
    resetUsageForAccount?: string;
  };

  const hasFieldsUpdate = body.fields !== undefined || body.setTag !== undefined;
  const hasAccessUpdate = Array.isArray(body.accessAccountIds);
  const hasReset = body.resetUsage === true;
  const hasResetForAccount =
    typeof body.resetUsageForAccount === "string" && body.resetUsageForAccount.length > 0;

  if (!hasFieldsUpdate && !hasAccessUpdate && !hasReset && !hasResetForAccount) {
    return NextResponse.json({ error: "Aucun champ à mettre à jour" }, { status: 400 });
  }

  const entry = await prisma.dataEntry.findUnique({ where: { id: entryId }, select: { id: true, libraryId: true } });
  if (!entry || entry.libraryId !== libraryId) {
    return NextResponse.json({ error: "Entrée introuvable" }, { status: 404 });
  }

  // Toutes les sous-opérations dans une seule transaction — un succès partiel
  // laissait autrefois l'entry à moitié mise à jour (finding library-10).
  try {
    await prisma.$transaction(async (tx) => {
      if (hasFieldsUpdate) {
        const dataUpdate: { fields?: string; setTag?: string | null } = {};
        if (body.fields !== undefined) {
          dataUpdate.fields = JSON.stringify(body.fields);
        }
        if (body.setTag !== undefined) {
          dataUpdate.setTag = body.setTag ?? null;
        }
        await tx.dataEntry.update({ where: { id: entryId }, data: dataUpdate });
      }

      if (hasReset) {
        await tx.dataEntry.update({
          where: { id: entryId },
          data: { usageCount: 0, lastUsedAt: null },
        });
        await tx.dataEntryUsage.deleteMany({ where: { entryId } });
      }

      if (hasResetForAccount) {
        await tx.dataEntryUsage.deleteMany({
          where: { entryId, accountId: body.resetUsageForAccount },
        });
      }

      if (hasAccessUpdate) {
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
      select: {
        id: true,
        fields: true,
        setTag: true,
        usageCount: true,
        lastUsedAt: true,
        createdAt: true,
        accesses: { select: { accountId: true } },
      },
    });
    if (!updated) return NextResponse.json({ error: "Entrée introuvable" }, { status: 404 });

    const { accesses, ...rest } = updated;
    return NextResponse.json({ ...rest, accessAccountIds: accesses.map((a) => a.accountId) });
  } catch (err) {
    console.error(`[admin/libraries/data/${libraryId}/entries/${entryId}] PATCH error:`, err);
    return NextResponse.json({ error: "Erreur serveur lors de la mise à jour" }, { status: 500 });
  }
}

// DELETE /api/admin/libraries/data/[id]/entries/[entryId]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  const { id: libraryId, entryId } = await params;

  const entry = await prisma.dataEntry.findUnique({ where: { id: entryId }, select: { id: true, libraryId: true } });
  if (!entry || entry.libraryId !== libraryId) {
    return NextResponse.json({ error: "Entrée introuvable" }, { status: 404 });
  }

  try {
    await prisma.dataEntry.delete({ where: { id: entryId } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[admin/libraries/data/${libraryId}/entries/${entryId}] DELETE error:`, err);
    return NextResponse.json({ error: "Erreur serveur lors de la suppression" }, { status: 500 });
  }
}
