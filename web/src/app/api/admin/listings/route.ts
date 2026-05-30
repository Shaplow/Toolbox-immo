import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/admin/listings — admin only, cross-user.
 *
 * Phase A/B refonte listings : pour qu'un admin puisse voir TOUTES les
 * générations (pas juste les siennes). Filtre optionnel ?userId=X.
 *
 * Pattern aligné sur /api/admin/users/route.ts (canAdminBypass strict pour
 * éviter qu'un user impersonné en admin via /api/admin/view-as accède aux
 * listings d'autres users — cf. CLAUDE.md Phase 1.8 § "Décision par usage").
 */
export async function GET(req: NextRequest) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const userIdFilter = req.nextUrl.searchParams.get("userId");
  const where = userIdFilter ? { userId: userIdFilter } : {};

  const listings = await prisma.listing.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      template: { select: { name: true, client: true } },
      user: { select: { id: true, name: true, email: true, role: true } },
    },
  });

  // Forme alignée sur GET /api/listings (jsonData parsé) pour réutiliser le client.
  return NextResponse.json(
    listings.map((l) => ({
      ...l,
      jsonData: JSON.parse(l.jsonData),
    })),
  );
}
