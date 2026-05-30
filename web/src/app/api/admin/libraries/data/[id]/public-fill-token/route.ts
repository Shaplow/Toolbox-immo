import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

// POST /api/admin/libraries/data/[id]/public-fill-token
// Génère (ou renouvelle) le token public — révoque l'ancien.
export async function POST(_req: Request, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }
  const { id } = await params;
  try {
    // 24 bytes hex = 48 chars — suffisant pour rendre l'enumération impossible.
    const token = randomBytes(24).toString("hex");
    const updated = await prisma.dataLibrary.update({
      where: { id },
      data: { publicFillToken: token },
      select: { publicFillToken: true },
    });
    return NextResponse.json({ token: updated.publicFillToken });
  } catch (err) {
    console.error(`[admin/libraries/data/${id}/public-fill-token] POST error:`, err);
    return NextResponse.json({ error: "Erreur serveur lors de la génération" }, { status: 500 });
  }
}

// DELETE /api/admin/libraries/data/[id]/public-fill-token
// Révoque le token public (l'URL existante ne fonctionnera plus).
export async function DELETE(_req: Request, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }
  const { id } = await params;
  try {
    await prisma.dataLibrary.update({
      where: { id },
      data: { publicFillToken: null },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[admin/libraries/data/${id}/public-fill-token] DELETE error:`, err);
    return NextResponse.json({ error: "Erreur serveur lors de la révocation" }, { status: 500 });
  }
}
