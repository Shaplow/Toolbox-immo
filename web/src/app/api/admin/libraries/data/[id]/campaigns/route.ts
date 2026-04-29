import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function adminOnly(role?: string) {
  return role !== "ADMIN";
}

type Params = { params: Promise<{ id: string }> };

// GET /api/admin/libraries/data/[id]/campaigns — liste les DataCampaign d'une DataLibrary
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id || adminOnly(session.user.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;
  let library;
  try {
    library = await prisma.dataLibrary.findUnique({ where: { id } });
  } catch (err) {
    console.error(`[admin/libraries/data/${id}/campaigns] GET error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
  if (!library) {
    return NextResponse.json({ error: "Bibliothèque introuvable" }, { status: 404 });
  }

  try {
    const campaigns = await prisma.dataCampaign.findMany({
      where: { libraryId: id },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { entries: true } },
      },
    });

    // Ajouter le nombre d'entrées déjà utilisées dans le cycle
    const campaignsWithStats = await Promise.all(
      campaigns.map(async (c) => {
        const usedCount = await prisma.dataEntry.count({
          where: { campaignId: c.id, usedInCycle: true },
        });
        return { ...c, usedInCycleCount: usedCount };
      })
    );
    return NextResponse.json(campaignsWithStats);
  } catch (err) {
    console.error(`[admin/libraries/data/${id}/campaigns] findMany error:`, err);
    return NextResponse.json({ error: "Erreur serveur lors du chargement des campaigns" }, { status: 500 });
  }
}

// POST /api/admin/libraries/data/[id]/campaigns — crée une DataCampaign
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id || adminOnly(session.user.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id: libId } = await params;
  let library;
  try {
    library = await prisma.dataLibrary.findUnique({ where: { id: libId } });
  } catch (err) {
    console.error(`[admin/libraries/data/${libId}/campaigns] POST error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
  if (!library) {
    return NextResponse.json({ error: "Bibliothèque introuvable" }, { status: 404 });
  }

  const body = await req.json() as { name?: string; isActive?: boolean };
  const { name, isActive = false } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "Le nom est requis" }, { status: 400 });
  }

  // Si la nouvelle campaign doit être active, désactiver les autres
  try {
    const campaign = await prisma.$transaction(async (tx) => {
      if (isActive) {
        await tx.dataCampaign.updateMany({
          where: { libraryId: libId },
          data: { isActive: false },
        });
      }
      return tx.dataCampaign.create({
        data: {
          libraryId: libId,
          name: name.trim(),
          isActive,
        },
      });
    });
    return NextResponse.json(campaign, { status: 201 });
  } catch (err) {
    console.error(`[admin/libraries/data/${libId}/campaigns] POST transaction error:`, err);
    return NextResponse.json({ error: "Erreur serveur lors de la création" }, { status: 500 });
  }
}
