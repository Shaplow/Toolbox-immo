import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function adminOnly(role?: string) {
  return role !== "ADMIN";
}

// POST /api/admin/accounts/[id]/cursors/reset — remet tous les curseurs d'un compte à 0
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id || adminOnly(session.user.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;
  try {
    await prisma.accountLibraryCursor.updateMany({
      where: { accountId: id },
      data: { cursor: 0, lastAdvancedAt: null },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/accounts/[id]/cursors/reset] POST error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
