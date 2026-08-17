import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

// GET /api/admin/libraries/data/[id]/entries — liste les DataEntry d'une DataLibrary.
// Query params: ?accountId= (optional) → retourne usageCount/lastUsedAt par compte.
//
// Plan simplification Phase 4 : remplace campaigns/[campaignId]/entries — les
// fiches sont désormais rattachées directement à la bibliothèque (libraryId),
// sans wrapper campagne. `category` / `usedInCycle` ne sont plus sélectionnés
// (colonnes dépréciées, plus lues).
export async function GET(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id: libraryId } = await params;
  const accountId = req.nextUrl.searchParams.get("accountId") ?? undefined;

  try {
    const library = await prisma.dataLibrary.findUnique({ where: { id: libraryId }, select: { id: true } });
    if (!library) {
      return NextResponse.json({ error: "Bibliothèque introuvable" }, { status: 404 });
    }

    const entries = await prisma.dataEntry.findMany({
      where: { libraryId },
      select: {
        id: true,
        fields: true,
        setTag: true,
        usageCount: true,
        lastUsedAt: true,
        createdAt: true,
        accesses: { select: { accountId: true } },
        usages: accountId
          ? { where: { accountId }, select: { usageCount: true, lastUsedAt: true } }
          : false,
      },
      orderBy: [{ usageCount: "asc" }, { createdAt: "asc" }],
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
    console.error(`[admin/libraries/data/${libraryId}/entries] GET error:`, err);
    return NextResponse.json({ error: "Erreur serveur lors du chargement" }, { status: 500 });
  }
}

// POST /api/admin/libraries/data/[id]/entries — crée une fiche manuellement.
// body: { setTag?: string | null, fields: Record<string, string> }
export async function POST(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id: libraryId } = await params;
  const body = (await req.json()) as { setTag?: string | null; fields?: Record<string, string> };

  if (!body.fields || typeof body.fields !== "object") {
    return NextResponse.json({ error: "fields requis (objet clé/valeur)" }, { status: 400 });
  }

  try {
    const library = await prisma.dataLibrary.findUnique({ where: { id: libraryId }, select: { id: true } });
    if (!library) {
      return NextResponse.json({ error: "Bibliothèque introuvable" }, { status: 404 });
    }

    const entry = await prisma.dataEntry.create({
      data: {
        libraryId,
        setTag: body.setTag?.trim() || null,
        fields: JSON.stringify(body.fields),
      },
    });
    return NextResponse.json(entry, { status: 201 });
  } catch (err) {
    console.error(`[admin/libraries/data/${libraryId}/entries] POST error:`, err);
    return NextResponse.json({ error: "Erreur serveur lors de la création" }, { status: 500 });
  }
}
