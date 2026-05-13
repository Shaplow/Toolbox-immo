/**
 * GET  /api/admin/offers — liste toutes les offres
 * POST /api/admin/offers — créer une offre (admin uniquement)
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const userContext = await getUserContext();
  if (!userContext?.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const offers = await prisma.offer.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json(offers);
}

export async function POST(req: NextRequest) {
  const userContext = await getUserContext();
  if (!userContext?.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const body = await req.json() as { name?: string };
  const name = body.name?.trim().toUpperCase();

  if (!name) {
    return NextResponse.json({ error: "Le nom de l'offre est requis" }, { status: 400 });
  }

  try {
    const offer = await prisma.offer.create({ data: { name } });
    return NextResponse.json(offer, { status: 201 });
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
      return NextResponse.json({ error: "Une offre avec ce nom existe déjà" }, { status: 409 });
    }
    console.error("[admin/offers] POST error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
