/**
 * GET /api/worklist/count — nombre de publications actives concernant l'utilisateur.
 *
 * Sémantique par rôle (Phase 6.1 audit Coquille) :
 *   ADMIN              → slots en alerte : scheduledAt dépassé ET statut non-terminal
 *   MONTEUR            → slots où assigneeMonteurId = me, statut non-terminal
 *   CM                 → slots où assigneeCmId = me, statut non-terminal
 *   VIDEASTE           → 0 (pas de slots assignés directement dans le schéma)
 *   EXTERNAL_GENERATOR → 0 (pas de worklist)
 *
 * L'impersonation s'applique via effectiveUser (cohérent avec M2).
 * Pas de cache : count temps réel, base < 100 rows, < 10 utilisateurs.
 *
 * Fix Phase 6.1 : avant ce fix, VIDEASTE retournait silencieusement 0
 * faute de branche dans le switch (bug runtime P1 audit bug-hunter).
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import { TERMINAL_STATUSES } from "@/types/roles";
import { toUserRole } from "@/lib/permissions/role";

export async function GET() {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;

  // Rôles sans worklist — réponse immédiate explicite.
  if (role === "EXTERNAL_GENERATOR" || role === "VIDEASTE") {
    return NextResponse.json({ count: 0 }, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  // Filtre statuts non-terminaux commun à MONTEUR / CM / ADMIN
  const notInTerminal = { notIn: TERMINAL_STATUSES as unknown as string[] };

  let count = 0;

  if (role === "ADMIN") {
    // Alerte admin : slots dont la date de publication est dépassée mais qui
    // ne sont pas encore terminés — signal d'attention dans la worklist admin.
    // Exclut explicitement les slots en banque (scheduledAt: null) — null serait
    // coerce en 0 (1970) et chaque slot banque serait compté à tort.
    count = await prisma.publicationSlot.count({
      where: {
        scheduledAt: { lt: new Date(), not: null },
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
  } else {
    // Cas impossible avec UserRole connu — warning si un nouveau rôle est
    // ajouté sans mise à jour de cette route.
    console.warn("[worklist/count] unhandled role, returning 0", {
      role,
      effectiveUserId: userId,
      rawRole: userContext.effectiveUser.role,
    });
  }

  return NextResponse.json({ count }, {
    headers: { "Cache-Control": "no-store" },
  });
}
