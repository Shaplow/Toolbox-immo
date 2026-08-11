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
 * Body : vide (POST uniquement — pas de GET pour réduire la surface en prod)
 *
 * Réponse :
 *   200 { scanned, orphans, deleted, dryRun, multipart: { found, aborted, bytesFreed } }
 *
 * Deux nettoyages distincts sont exécutés :
 *   1. Objets orphelins (ListObjectsV2 + cross-check DB) — cf. lib/r2Cleanup.ts
 *   2. Uploads multipart inachevés — INVISIBLES pour ListObjectsV2 (un multipart
 *      en cours n'est pas un objet), donc jamais couverts par le point 1, alors
 *      que R2 facture les parties déjà poussées. Un onglet fermé pendant un
 *      upload de 100 Go coûte 100 Go permanents sans ce nettoyage.
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
import { abortStaleMultipartUploads } from "@/lib/r2Multipart";
import { MULTIPART } from "@/lib/upload/limits";
import { timingSafeEqualStrings } from "@/lib/utils";

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

  // 2. Vérification du header d'authentification (timing-safe pour éviter les
  //    attaques side-channel sur la longueur/contenu du secret).
  const providedSecret = req.headers.get("x-cron-secret");
  if (!timingSafeEqualStrings(providedSecret, cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 3. Paramètre dryRun
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "true";

  // 4. Exécution du nettoyage
  try {
    const result = await cleanupOrphanR2Objects({ dryRun });
    console.log(`[cron/r2-cleanup] Orphelins — scanned=${result.scanned}, orphans=${result.orphans}, deleted=${result.deleted}, dryRun=${result.dryRun}`);

    // Uploads multipart inachevés. Best-effort et isolé du bloc précédent : un
    // échec ici ne doit pas masquer le résultat du nettoyage d'orphelins, qui a
    // déjà eu lieu.
    let multipart: Awaited<ReturnType<typeof abortStaleMultipartUploads>> | { error: string };
    try {
      multipart = await abortStaleMultipartUploads(MULTIPART.STALE_ABORT_MS, { dryRun });
      console.log(
        `[cron/r2-cleanup] Multipart inachevés — found=${multipart.found}, ` +
          `aborted=${multipart.aborted}, freed=${(multipart.bytesFreed / 1024 ** 3).toFixed(2)} Go, ` +
          `dryRun=${multipart.dryRun}`,
      );
    } catch (mpErr) {
      console.error("[cron/r2-cleanup] Abandon des multipart inachevés échoué :", mpErr);
      multipart = { error: mpErr instanceof Error ? mpErr.message : "Erreur interne" };
    }

    return NextResponse.json({ ...result, multipart });
  } catch (err) {
    console.error("[cron/r2-cleanup] Erreur :", err);
    const message = err instanceof Error ? err.message : "Erreur interne";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
