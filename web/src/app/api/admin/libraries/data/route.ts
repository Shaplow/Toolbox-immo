import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

// GET /api/admin/libraries/data — liste les DataLibrary (+ campaign count)
export async function GET() {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  try {
    const libraries = await prisma.dataLibrary.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { campaigns: true } },
        // Phase 1 data refonte — récupère la campagne active (1 max par lib enforced backend)
        // + son count d'entries pour badge proéminent côté card.
        campaigns: {
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            _count: { select: { entries: true } },
          },
          take: 1,
        },
      },
    });
    // Renomme `campaigns[0]` en `activeCampaign` pour clarté côté client.
    const enriched = libraries.map(({ campaigns, ...lib }) => ({
      ...lib,
      activeCampaign: campaigns[0]
        ? { id: campaigns[0].id, name: campaigns[0].name, entryCount: campaigns[0]._count.entries }
        : null,
    }));
    return NextResponse.json(enriched);
  } catch (err) {
    console.error("[admin/libraries/data] GET error:", err);
    return NextResponse.json({ error: "Erreur serveur lors du chargement" }, { status: 500 });
  }
}

// POST /api/admin/libraries/data — crée une DataLibrary
export async function POST(req: NextRequest) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const body = await req.json() as { name?: string; templateType?: string; description?: string };
  const { name, templateType, description } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "Le nom est requis" }, { status: 400 });
  }
  if (!templateType?.trim()) {
    return NextResponse.json({ error: "Le templateType est requis (ex: RPI, RTIPS)" }, { status: 400 });
  }

  try {
    // Phase 1.x — UX simplification : à la création d'une DataLibrary, on
    // auto-crée silencieusement une DataCampaign "Default" isActive=true en
    // usagePolicy=unlimited (toujours la moins utilisée, jamais bloquée).
    // L'admin ne voit plus le concept de campagne en UI — la lib devient une
    // simple liste de fiches qui tournent en boucle.
    const library = await prisma.$transaction(async (tx) => {
      const lib = await tx.dataLibrary.create({
        data: {
          name: name.trim(),
          templateType: templateType.trim().toUpperCase(),
          description: description?.trim() ?? null,
        },
      });
      await tx.dataCampaign.create({
        data: {
          libraryId: lib.id,
          name: "Default",
          isActive: true,
          usagePolicy: "unlimited",
        },
      });
      return lib;
    });
    return NextResponse.json(library, { status: 201 });
  } catch (err) {
    console.error("[admin/libraries/data] POST error:", err);
    return NextResponse.json({ error: "Erreur serveur lors de la création" }, { status: 500 });
  }
}
