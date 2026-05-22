import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function adminOnly(role?: string) {
  return role !== "ADMIN";
}

// PATCH /api/admin/accounts/[id] — met à jour un compte Instagram
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id || adminOnly(session.user.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json() as { name?: string; handle?: string; offre?: string; clientId?: string | null };
  const { name, handle, offre, clientId } = body;

  const data: { name?: string; handle?: string; offre?: string; clientId?: string | null } = {};
  if (name?.trim()) data.name = name.trim();
  if (handle?.trim()) data.handle = handle.trim().replace(/^@/, "");
  if (offre) {
    const existingOffer = await prisma.offer.findUnique({ where: { name: offre } });
    if (!existingOffer) {
      return NextResponse.json({ error: `Offre inconnue : ${offre}` }, { status: 400 });
    }
    data.offre = offre;
  }
  if ("clientId" in body) {
    if (clientId === null) {
      data.clientId = null;
    } else if (typeof clientId === "string" && clientId.trim()) {
      data.clientId = clientId.trim();
    }
  }

  try {
    const account = await prisma.instagramAccount.update({ where: { id }, data });
    return NextResponse.json(account);
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2025") {
      return NextResponse.json({ error: "Compte introuvable" }, { status: 404 });
    }
    console.error("[admin/accounts/[id]] PATCH error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

// DELETE /api/admin/accounts/[id] — supprime un compte Instagram
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id || adminOnly(session.user.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;
  try {
    await prisma.instagramAccount.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2025") {
      return NextResponse.json({ error: "Compte introuvable" }, { status: 404 });
    }
    console.error("[admin/accounts/[id]] DELETE error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
