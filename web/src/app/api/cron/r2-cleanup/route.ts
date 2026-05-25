/**
 * POST /api/cron/r2-cleanup
 *
 * Endpoint cron protégé par secret pour nettoyer les objets R2 orphelins.
 *
 * Auth : header "x-cron-secret: <CRON_SECRET>" obligatoire → 401 si absent/invalide.
 *        Si CRON_SECRET non configuré → 503 (config manquante).
 *
 * Query params :
 *   ?dryRun=true  — liste les orphelins sans les supprimer (safe par défaut en prod)
 *
 * Body : vide (GET ou POST)
 *
 * Réponse :
 *   200 { scanned, orphans, deleted, dryRun }
 *
 * Câblage externe (Vercel cron, cron-job.org, etc.) :
 *   - Méthode : POST
 *   - URL     : https://<votre-domaine>/api/cron/r2-cleanup
 *   - Header  : x-cron-secret: <valeur de CRON_SECRET>
 *   - Schedule: 0 4 * * * (chaque nuit à 4h00 UTC)
 *
 * Pour un dry-run manuel :
 *   curl -X POST https://<domaine>/api/cron/r2-cleanup?dryRun=true \
 *        -H "x-cron-secret: <secret>"
 */

import { NextRequest, NextResponse } from "next/server";
import { cleanupOrphanR2Objects } from "@/lib/r2Cleanup";

export async function POST(req: NextRequest) {
  // 1. Vérification de la configuration du secret
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.warn("[cron/r2-cleanup] CRON_SECRET non configuré.");
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 503 }
    );
  }

  // 2. Vérification du header d'authentification
  const providedSecret = req.headers.get("x-cron-secret");
  if (!providedSecret || providedSecret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 3. Paramètre dryRun
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "true";

  // 4. Exécution du nettoyage
  try {
    const result = await cleanupOrphanR2Objects({ dryRun });
    console.log(`[cron/r2-cleanup] Terminé — scanned=${result.scanned}, orphans=${result.orphans}, deleted=${result.deleted}, dryRun=${result.dryRun}`);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[cron/r2-cleanup] Erreur :", err);
    const message = err instanceof Error ? err.message : "Erreur interne";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Accepte également GET pour les health checks / dry-run manuels depuis un browser
export async function GET(req: NextRequest) {
  return POST(req);
}
