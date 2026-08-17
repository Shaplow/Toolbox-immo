import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/users/touch
 *
 * Met à jour `User.lastSeenAt` à `now()` pour l'utilisateur courant.
 * Appelée par les pages /home (chargement initial) pour alimenter le widget
 * "Depuis votre dernière visite" sur HomeAdmin.
 *
 * Best-effort : si la colonne n'existe pas encore (migration pas appliquée),
 * on swallow l'erreur — l'app reste fonctionnelle sans le widget.
 *
 * Note : `actualUser.id` est utilisé (pas effectiveUser) — quand un ADMIN
 * impersonne un autre rôle, c'est bien sa propre visite qui compte.
 */
export async function POST() {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;

  try {
    await prisma.user.update({
      where: { id: userContext.actualUser.id },
      data: { lastSeenAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.warn("[users/touch] update failed (migration pending?):", err);
    return NextResponse.json({ ok: true, skipped: true });
  }
}
