/**
 * POST /api/cron/caption-retention
 *
 * Endpoint cron protégé par secret : supprime de R2 les vidéos sous-titrées de
 * l'Atelier (CaptionJob sans publication) restées 60 jours sans activité, c'est-à-dire
 * sans génération ni téléchargement passé par l'app. La ligne reste en historique,
 * marquée « Expirée ». Règles et exclusions : lib/captions/outputRetention.ts ; ordre des
 * écritures et garde-fous : lib/services/captions/expireOutputs.ts.
 *
 * Auth : header "x-cron-secret: <CRON_SECRET>" obligatoire → 401 si absent/invalide.
 *        Si CRON_SECRET non configuré → 503 (config manquante).
 *
 * Query params (mêmes règles que /api/cron/r2-cleanup, cf. parseCleanupParams) :
 *   (aucun)        — DRY-RUN : rapporte ce qui serait supprimé, sans rien écrire (défaut)
 *   ?apply=1       — passage réel : réclame puis supprime les vidéos expirées…
 *   &maxDeletes=N  — …tant qu'il y en a au plus N (500 par défaut) ; au-delà, rien n'est
 *                    réclamé et la réponse porte `refused`
 *   ?dryRun=true   — ancienne forme, reste un dry-run
 *
 * Body : vide (POST uniquement — pas de GET pour réduire la surface en prod)
 *
 * Réponse :
 *   200 { dryRun, retentionDays, cutoff, candidates, claimed, deleted, pendingRetried,
 *         pendingLeft, skipped, errors, nonTerminalStale, bytes, byKind, byStatus, byUser,
 *         samples, refused: null }
 *   409 même corps, avec `refused: { reason, maxDeletes }` : le disjoncteur a refusé le
 *       passage réel, aucune vidéo n'a été réclamée. Un statut d'erreur plutôt qu'un 200,
 *       sinon cron-job.org ou la crontab y voient un succès et le stockage continue de
 *       grossir sans alerte.
 *   500 { error } : R2 non configuré, base indisponible…
 *   Une suppression R2 qui échoue n'est PAS une erreur HTTP : la ligne reste « en attente »
 *   (`pendingLeft`, `errors`) et le passage suivant la reprend.
 *   Relire `samples`, `byUser`, `bytes`, `byStatus` et `skipped` d'un dry-run avant le
 *   premier passage réel : `skipped.sharedKey` et `skipped.unsafeKey` doivent rester à 0.
 *   `byStatus.failed` compte des sous-titrages en échec, réclamés comme les autres : la
 *   plupart n'ont aucun fichier (`bytes.missingInR2`) et comptent quand même face à `maxDeletes`.
 *
 * Câblage externe : un second POST depuis le script nocturne du serveur
 * (/usr/local/bin/toolbox-r2-cleanup), à la suite du nettoyage des orphelins.
 *   - Méthode : POST
 *   - URL     : https://<votre-domaine>/api/cron/caption-retention?apply=1
 *   - Header  : x-cron-secret: <valeur de CRON_SECRET>
 *   Relire un dry-run avant le premier passage réel : il supprime d'un coup tout ce qui a
 *   plus de 60 jours, probablement au-delà des 500 par défaut (le dry-run donne le nombre
 *   exact). Le lancer à la main avec un `maxDeletes` assumé, puis seulement câbler le
 *   passage nocturne au plafond par défaut.
 *
 * Pour un dry-run manuel :
 *   curl -X POST https://<domaine>/api/cron/caption-retention \
 *        -H "x-cron-secret: <secret>"
 */

import { NextRequest, NextResponse } from "next/server";
import { parseCleanupParams } from "@/lib/r2Cleanup";
import { expireAtelierCaptionOutputs } from "@/lib/services/captions/expireOutputs";
import { timingSafeEqualStrings } from "@/lib/utils";

export async function POST(req: NextRequest) {
  // 1. Vérification de la configuration du secret
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.warn("[cron/caption-retention] CRON_SECRET non configuré.");
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

  // 3. Paramètres : dry-run sauf `apply=1`, plafond de suppressions
  const { dryRun, maxDeletes } = parseCleanupParams(new URL(req.url).searchParams);

  // 4. Exécution de la purge
  try {
    const report = await expireAtelierCaptionOutputs({ dryRun, maxDeletes });
    const volume = report.bytes ? `${(report.bytes.candidates / 1024 ** 3).toFixed(2)} Go` : "volume inconnu";
    const summary =
      `[cron/caption-retention] Vidéos sous-titrées — candidates=${report.candidates} (${volume}), ` +
      `claimed=${report.claimed}, deleted=${report.deleted}, ` +
      `pendingRetried=${report.pendingRetried}, pendingLeft=${report.pendingLeft}, ` +
      `skipped=${JSON.stringify(report.skipped)}, errors=${report.errors}, dryRun=${report.dryRun}`;
    if (report.refused) {
      // Erreur, pas info : un passage réel refusé chaque nuit doit se voir.
      console.error(
        `${summary}, REFUSÉ : plus de ${report.refused.maxDeletes} vidéos à supprimer, rien n'a été réclamé ` +
          `(relire un dry-run, puis relancer avec un maxDeletes plus haut)`,
      );
    } else {
      console.log(summary);
    }

    // 409 si le disjoncteur a refusé le passage réel : corps inchangé, mais le
    // cron externe voit un échec.
    return NextResponse.json(report, { status: report.refused ? 409 : 200 });
  } catch (err) {
    console.error("[cron/caption-retention] Erreur :", err);
    const message = err instanceof Error ? err.message : "Erreur interne";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
