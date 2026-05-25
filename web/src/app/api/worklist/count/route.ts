/**
 * GET /api/worklist/count — nombre de publications actives concernant l'utilisateur.
 *
 * Sémantique par rôle (commit 1.2.8) :
 *   MONTEUR → slots où assigneeMonteurId = me, statut non-terminal
 *   CM      → slots où assigneeCmId = me, statut non-terminal
 *   ADMIN   → slots en alerte : scheduledAt dépassé ET statut non-terminal
 *   USER    → 0 (pas de worklist)
 *
 * L'impersonation s'applique via effectiveUser (cohérent avec M2).
 * Pas de cache : count temps réel, base < 100 rows, < 10 utilisateurs.
 */
import { NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { TERMINAL_STATUSES } from "@/types/roles";
import { toUserRole } from "@/lib/permissions/role";

export async function GET() {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;

  // USER n'a pas de worklist — réponse immédiate
  if (role === "USER") {
    return NextResponse.json({ count: 0 }, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  // Filtre statuts non-terminaux commun à MONTEUR / CM
  const notInTerminal = { notIn: TERMINAL_STATUSES as unknown as string[] };

  let count = 0;

  if (role === "ADMIN") {
    // Alerte admin : slots dont la date de publication est dépassée mais qui
    // ne sont pas encore terminés — signal d'attention dans la worklist admin.
    count = await prisma.publicationSlot.count({
      where: {
        scheduledAt: { lt: new Date() },
        status: notInTerminal,
      },
    });
  } else if (role === "MONTEUR") {
    count = await prisma.publicationSlot.count({
      where: {
        assigneeMonteurId: userId,
        status: notInTerminal,
      },
    });
  } else if (role === "CM") {
    count = await prisma.publicationSlot.count({
      where: {
        assigneeCmId: userId,
        status: notInTerminal,
      },
    });
  }

  return NextResponse.json({ count }, {
    headers: { "Cache-Control": "no-store" },
  });
}
