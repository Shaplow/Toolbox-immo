import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

// POST /api/admin/accounts/[id]/cursors/reset — remet à zéro l'ensemble des
// curseurs (Media + Data) du compte. Atomicité via $transaction pour ne pas
// laisser un état partiel si l'un des updateMany échoue.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;
  try {
    const [media, data] = await prisma.$transaction([
      prisma.accountLibraryCursor.updateMany({
        where: { accountId: id },
        data: {
          cursor: 0,
          lastAdvancedAt: null,
          lastUsedSetTag: null,
          lastUsedCategory: null,
        },
      }),
      prisma.accountDataLibraryCursor.updateMany({
        where: { accountId: id },
        data: {
          lastAdvancedAt: null,
          lastUsedSetTag: null,
          lastUsedCategory: null,
        },
      }),
    ]);
    return NextResponse.json({
      ok: true,
      mediaCount: media.count,
      dataCount: data.count,
    });
  } catch (err) {
    console.error("[admin/accounts/[id]/cursors/reset] POST error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
