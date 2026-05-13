/**
 * PATCH  /api/admin/offers/[id] — renommer une offre (admin uniquement)
 * DELETE /api/admin/offers/[id] — supprimer une offre (admin uniquement)
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json() as { name?: string };
  const name = body.name?.trim().toUpperCase();

  if (!name) {
    return NextResponse.json({ error: "Le nom est requis" }, { status: 400 });
  }

  try {
    const offer = await prisma.offer.update({ where: { id }, data: { name } });
    return NextResponse.json(offer);
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err) {
      const code = (err as { code: string }).code;
      if (code === "P2025") return NextResponse.json({ error: "Offre introuvable" }, { status: 404 });
      if (code === "P2002") return NextResponse.json({ error: "Ce nom est déjà utilisé" }, { status: 409 });
    }
    console.error("[admin/offers/[id]] PATCH error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;

  try {
    await prisma.offer.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2025") {
      return NextResponse.json({ error: "Offre introuvable" }, { status: 404 });
    }
    console.error("[admin/offers/[id]] DELETE error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
