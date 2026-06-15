/**
 * GET /api/admin/accounts/[id]/peek — payload léger pour AccountPeekDrawer.
 *
 * Renvoie un résumé compact (identité, client, planning effectif, stats slots
 * agrégés, prochaine publication) sans charger les bindings complets ni les
 * relations lourdes. À utiliser dans le drawer rapide d'aperçu — la fiche
 * complète reste accessible via /admin/accounts/[id].
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const ctx = await getUserContext();
  if (!ctx?.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }
  const { id } = await params;

  const account = await prisma.instagramAccount.findUnique({
    where: { id },
    select: {
      id: true,
      handle: true,
      name: true,
      client: { select: { id: true, name: true } },
    },
  });
  if (!account) {
    return NextResponse.json({ error: "Compte introuvable" }, { status: 404 });
  }

  const [bindingActive, bindingTotal, lastPublishedSlot, nextSlot, byStatus] =
    await Promise.all([
      prisma.patternBinding.count({ where: { accountId: id, isActive: true } }),
      prisma.patternBinding.count({ where: { accountId: id } }),
      prisma.publicationSlot.findFirst({
        where: { accountId: id, publishedAt: { not: null } },
        orderBy: { publishedAt: "desc" },
        select: { publishedAt: true },
      }),
      prisma.publicationSlot.findFirst({
        where: {
          accountId: id,
          scheduledAt: { not: null, gte: new Date() },
          status: { notIn: ["DONE", "CANCELLED"] },
        },
        orderBy: { scheduledAt: "asc" },
        select: {
          id: true,
          scheduledAt: true,
          status: true,
          patternBinding: {
            select: {
              customLabel: true,
              patternTemplate: { select: { label: true } },
            },
          },
        },
      }),
      prisma.publicationSlot.groupBy({
        by: ["status"],
        where: { accountId: id },
        _count: { _all: true },
      }),
    ]);

  const statsByStatus: Record<string, number> = {};
  for (const row of byStatus) {
    statsByStatus[row.status] = row._count._all;
  }

  const nextScheduled = nextSlot
    ? {
        id: nextSlot.id,
        scheduledAt: nextSlot.scheduledAt!.toISOString(),
        status: nextSlot.status,
        label:
          nextSlot.patternBinding?.customLabel ??
          nextSlot.patternBinding?.patternTemplate?.label ??
          null,
      }
    : null;

  return NextResponse.json({
    id: account.id,
    handle: account.handle,
    name: account.name,
    client: account.client,
    activeBindingsCount: bindingActive,
    totalBindingsCount: bindingTotal,
    lastPublishedAt: lastPublishedSlot?.publishedAt?.toISOString() ?? null,
    nextScheduled,
    statsByStatus,
  });
}
