import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { canManageMediaAssets } from "@/lib/permissions/mediaLibrary";
import { prisma } from "@/lib/prisma";
import { submitRunpodJob, runpodConfigured } from "@/lib/runpod";
import { getRunpodWebhookUrl } from "@/lib/webhooks/runpod";
import { mapWithConcurrency } from "@/lib/concurrency";
import { failAutocutBatch } from "@/lib/mediaAutocutServer";

type Params = { params: Promise<{ id: string }> };

const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY ?? "";
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID ?? "";
/**
 * 10 et non 20 : le worker borne désormais son temps (budget par item + budget de
 * pack) et rend ses résultats partiels, mais un kill dur du conteneur (OOM,
 * préemption) ne renvoie toujours rien. Des packs plus petits divisent par deux
 * le rayon de souffle résiduel ; le surcoût est quasi nul, le modèle Whisper
 * étant mis en cache dans le process et les workers RunPod restant chauds.
 */
const PACK_SIZE = 10;

/**
 * Budget de traitement d'un pack côté worker, en secondes (AUTOCUT_PACK_BUDGET_S).
 * Envoyé dans l'input pour que le web reste maître du couple budget/timeout.
 */
const PACK_BUDGET_S = 1500;

/**
 * Doit rester STRICTEMENT supérieur à PACK_BUDGET_S : le worker gagne la course
 * et retourne ses résultats partiels avant que RunPod ne tue le job. Posé
 * explicitement pour ne pas dépendre du réglage console de l'endpoint.
 * Sans effet sur le chemin Pod On-Demand, qui n'a aucun timeout d'exécution —
 * là, seul le budget worker protège.
 */
const EXECUTION_TIMEOUT_MS = (PACK_BUDGET_S + 300) * 1000;

/**
 * POST /api/admin/libraries/media/[libraryId]/autocut-packs
 *
 * Soumet un ou plusieurs packs Whisper à RunPod pour analyser des assets en lot.
 * 1 RunPod job = max 20 assets (Whisper chargé une seule fois par pack).
 *
 * Body : { assetIds: string[], language?: string, modelSize?: string }
 * Retourne : { batches: [{ batchId, assetCount, status }], skipped: string[] }
 */
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  if (!canManageMediaAssets(auth.ctx.effectiveUser.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id: libraryId } = await params;

  // Vérifier que la lib existe et est de type video
  const library = await prisma.mediaLibrary.findUnique({ where: { id: libraryId } });
  if (!library) {
    return NextResponse.json({ error: "Bibliothèque introuvable" }, { status: 404 });
  }
  if (library.type !== "video") {
    return NextResponse.json({ error: "L'autocut est réservé aux bibliothèques vidéo" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const assetIds = Array.isArray(body.assetIds) ? (body.assetIds as string[]) : [];
  if (assetIds.length === 0) {
    return NextResponse.json({ error: "assetIds requis (tableau non vide)" }, { status: 400 });
  }

  const language = typeof body.language === "string" ? body.language : "fr";
  const modelSize = typeof body.modelSize === "string" ? body.modelSize : "large-v3-turbo";

  // ── Sécurité : vérifier que tous les assetIds appartiennent à cette lib et ne sont pas désactivés ──
  const validAssets = await prisma.mediaAsset.findMany({
    where: { id: { in: assetIds }, libraryId, disabled: false },
    select: { id: true, url: true, filename: true },
  });
  if (validAssets.length !== assetIds.length) {
    return NextResponse.json(
      { error: "Certains assets n'appartiennent pas à cette bibliothèque ou sont désactivés" },
      { status: 403 }
    );
  }

  // ── Filtrer les assets ayant déjà un job actif ────────────────────────────
  // Un job est considéré actif tant qu'il a été mis à jour récemment. Au-delà, on
  // suppose le webhook perdu et on autorise la re-soumission.
  //
  // Ce seuil DOIT rester au-dessus de EXECUTION_TIMEOUT_MS : c'est la durée que
  // RunPod accorde au pack, à laquelle s'ajoute son temps de file d'attente. Le
  // caler dessus (ou dessous) rendrait « re-soumissible » un pack qui tourne
  // encore — sa relance effacerait ses jobs, le batch orphelin serait purgé, et
  // le webhook légitime qui arrive ensuite ne retrouverait plus rien à écrire :
  // des analyses déjà payées, perdues. La marge de 15 min couvre la file RunPod.
  //
  // Contrairement au sweep (qui coupe à l'ancienneté seule), la réconciliation
  // interroge RunPod avant de déclarer un batch mort — c'est elle qui rattrape
  // les vrais zombies, pas ce seuil.
  const STALE_THRESHOLD_MS = EXECUTION_TIMEOUT_MS + 15 * 60 * 1000;
  const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS);
  const activeJobs = await prisma.mediaAutocutJob.findMany({
    where: {
      assetId: { in: assetIds },
      status: { in: ["pending", "processing"] },
      updatedAt: { gt: staleThreshold },
    },
    select: { assetId: true },
  });
  const busyIds = new Set(activeJobs.map((j) => j.assetId));
  const toProcess = validAssets.filter((a) => !busyIds.has(a.id));
  const skipped = assetIds.filter((id) => busyIds.has(id));

  if (toProcess.length === 0) {
    return NextResponse.json({
      batches: [],
      skipped,
      message: "Tous les assets sélectionnés ont déjà un job en cours",
    });
  }

  // ── Invariant : une seule analyse vivante par asset ───────────────────────
  // Sans ça, un asset relancé accumule ses anciens jobs : les compteurs (par
  // ligne) divergent de l'affichage (par asset, dernier job), et la liste des
  // échecs montre un historique au lieu de l'état courant.
  //
  // On ne supprime QUE des jobs en état terminal. Un job encore `pending` ou
  // `processing` n'est jamais touché, même jugé périmé par STALE_THRESHOLD_MS :
  // supprimer les jobs d'un pack qui tourne encore ferait purger son batch
  // devenu orphelin, et son webhook n'aurait plus rien à écrire. Le zombie
  // survivant est inoffensif — la réconciliation le passera en échec, et
  // l'affichage retient de toute façon le job le plus récent par asset.
  //
  // `accepted` est exclu comme `applied` : le job porte des timings validés par
  // un admin et attend son batch-apply. L'UI empêche déjà de le sélectionner,
  // mais l'API ne doit pas dépendre de ce garde-fou côté client.
  const targetIds = toProcess.map((a) => a.id);
  await prisma.mediaAutocutJob.deleteMany({
    where: {
      assetId: { in: targetIds },
      status: { in: ["done", "failed"] },
      reviewStatus: { notIn: ["applied", "accepted"] },
      editJobId: null,
    },
  });
  await prisma.mediaAutocutBatch.deleteMany({ where: { libraryId, jobs: { none: {} } } });

  // ── Découper en packs, créer les batches, puis dispatcher RunPod EN FOND ──
  const batches: Array<{ batchId: string; assetCount: number; status: string }> = [];
  // Batches à soumettre à RunPod — dispatché en tâche de fond après la réponse.
  const toDispatch: Array<{
    batchId: string;
    assets: Array<{ job_id: string; asset_url: string; filename: string }>;
  }> = [];

  for (let i = 0; i < toProcess.length; i += PACK_SIZE) {
    const pack = toProcess.slice(i, i + PACK_SIZE);

    // Créer le batch + les jobs dans une transaction (rapide, synchrone)
    const { batch, jobs } = await prisma.$transaction(async (tx) => {
      const b = await tx.mediaAutocutBatch.create({
        data: {
          libraryId,
          status: "pending",
          totalCount: pack.length,
        },
      });
      const js = await Promise.all(
        pack.map((asset) =>
          tx.mediaAutocutJob.create({
            data: {
              assetId: asset.id,
              libraryId,
              batchId: b.id,
              status: "pending",
              reviewStatus: "pending_review",
            },
          })
        )
      );
      return { batch: b, jobs: js };
    });

    if (!runpodConfigured()) {
      console.warn(`[autocut-packs] RunPod non configuré — batch ${batch.id} en pending`);
      batches.push({ batchId: batch.id, assetCount: pack.length, status: "pending" });
      continue;
    }

    // Appariement explicite plutôt que deux tableaux parallèles indexés : le
    // filename part avec l'URL pour que les logs du worker nomment le fichier
    // qui bloque, sans aller-retour en base.
    toDispatch.push({
      batchId: batch.id,
      assets: pack.map((asset, i) => ({
        job_id: jobs[i].id,
        asset_url: asset.url,
        filename: asset.filename,
      })),
    });
    batches.push({ batchId: batch.id, assetCount: pack.length, status: "processing" });
  }

  // Dispatch RunPod EN FOND — enchaîner N cold-starts pod en série dans la requête
  // la ferait pendre plusieurs minutes. On répond 202 tout de suite et on soumet
  // les batches en tâche de fond, bornés à 2 en parallèle. Chaque batch se met à
  // jour (processing + runpodId) ou bascule failed selon le résultat de sa soumission.
  if (toDispatch.length > 0) {
    const webhookUrl = getRunpodWebhookUrl("/api/webhooks/runpod/media-autocut");
    if (!webhookUrl) {
      console.error(
        "[autocut-packs] NEXTAUTH_URL non défini — batches soumis sans webhook. " +
        "Les jobs resteront bloqués en processing. Configurer NEXTAUTH_URL."
      );
    }
    void (async () => {
      await mapWithConcurrency(toDispatch, 2, async ({ batchId, assets: packAssets }) => {
        try {
          const runpodResp = await submitRunpodJob<{ id: string }>(
            RUNPOD_ENDPOINT_ID,
            RUNPOD_API_KEY,
            {
              input: {
                job_type: "media_autocut_batch",
                batch_id: batchId,
                language,
                model_size: modelSize,
                pack_budget_s: PACK_BUDGET_S,
                assets: packAssets,
              },
              policy: { executionTimeout: EXECUTION_TIMEOUT_MS },
              ...(webhookUrl ? { webhook: webhookUrl } : {}),
            }
          );
          await prisma.$transaction(async (tx) => {
            await tx.mediaAutocutBatch.update({
              where: { id: batchId },
              data: { status: "processing", runpodId: runpodResp.id },
            });
            await tx.mediaAutocutJob.updateMany({
              where: { batchId },
              data: { status: "processing" },
            });
          });
        } catch (err) {
          console.error(`[autocut-packs] RunPod submit failed for batch ${batchId} (async):`, err);
          // Le vrai message part sur le batch ET sur ses jobs, tronqué à 500.
          await failAutocutBatch(batchId, err, { prefix: "Soumission RunPod" }).catch(() => {});
        }
      });
    })();
  }

  return NextResponse.json({ batches, skipped }, { status: 202 });
}
