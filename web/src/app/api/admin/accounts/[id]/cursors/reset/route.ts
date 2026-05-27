import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

// POST /api/admin/accounts/[id]/cursors/reset — remet tous les curseurs d'un compte à 0
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
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
