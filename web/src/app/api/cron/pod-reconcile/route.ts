/**
 * GET /api/cron/pod-reconcile
 *
 * Déclenche une vérification de l'état du pod : stale counter detection +
 * arrêt automatique si idle depuis IDLE_MINUTES.
 *
 * Ce cron est la seule source proactive de réconciliation du pod — sans lui,
 * si un webhook est perdu (réseau, redémarrage app, NEXTAUTH_URL invalide),
 * activeJobCount reste bloqué à > 0 et le pod tourne indéfiniment.
 *
 * Fréquence recommandée : toutes les 15 minutes (ou IDLE_MINUTES + 5 min).
 *
 * Protection : Authorization: Bearer <CRON_SECRET>.
 * Configurer le cron (crontab, supervisor, externe) pour appeler :
 *   GET /api/cron/pod-reconcile
 *   Authorization: Bearer <CRON_SECRET>
 */

import { NextRequest, NextResponse } from "next/server";
import { maybeStopIdlePod } from "@/lib/podOrchestrator";
import { prisma } from "@/lib/prisma";
import { timingSafeEqualStrings } from "@/lib/utils";

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET non configuré" }, { status: 500 });
  }

  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!timingSafeEqualStrings(token, cronSecret)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  // Snapshot avant réconciliation
  const before = await prisma.podState.findUnique({ where: { id: "singleton" } });

  // maybeStopIdlePod: détecte stale counter (> 4h) + arrête le pod si idle.
  // Toutes les décisions sont loggées dans la console du serveur.
  await maybeStopIdlePod();

  // Snapshot après réconciliation
  const after = await prisma.podState.findUnique({ where: { id: "singleton" } });

  return NextResponse.json({
    ok: true,
    before: before
      ? { status: before.status, activeJobCount: before.activeJobCount, podId: before.podId }
      : null,
    after: after
      ? { status: after.status, activeJobCount: after.activeJobCount, podId: after.podId }
      : null,
  });
}
