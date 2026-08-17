/**
 * recordLibraryUsage.ts
 *
 * Called after a Render reaches status=DONE. Reads `render.usedAssets` and
 * atomically increments usage counters on the relevant MediaAssets and DataEntry.
 *
 * Design: best-effort — errors are logged but do not throw (render already succeeded).
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { SHARED_USAGE_ACCOUNT_ID, SHARED_DATA_USAGE_ACCOUNT_ID } from "@/lib/rotation/sentinels";

/**
 * Forme du JSON stocké dans `Render.usedAssets`. Exportée pour permettre aux
 * routes /api/renders et helpers de generateRender de partager le type
 * exactement (avant W3.6 il était redéclaré inline avec 3 variantes
 * divergentes — finding rotation-5).
 */
export interface UsedAssets {
  /** blockId → assetId */
  videoAssets?: Record<string, string>;
  audioAssetId?: string;
  dataEntryId?: string;
  /** Libraries that used set_sequence — cursor/lastUsedSetTag will be updated */
  setSequencedLibraryIds?: string[];
  /** libraryId → resolved setTag used during this generation */
  usedSetTagByLibrary?: Record<string, string>;
  /** libraryId → cursor snapshot for failure-recovery revert */
  prevCursorStateByLibrary?: Record<string, CursorRevertState>;
  /** DataEntry claim state for failure-recovery revert */
  prevDataEntryState?: {
    entryId: string;
    campaignId: string;
    usagePolicy: string;
    claimType: "usedInCycle" | "perAccountUsage";
    accountId?: string;
  };
  /** Audio usage claim for failure-recovery revert */
  prevAudioUsageState?: {
    assetId: string;
    accountId: string;
    prevLastUsedAt: string | null;
    claimedLastUsedAt: string;
  };
  /** Claims d'usage vidéo posés au submit (Phase 3 dossiers) — revert on failure. */
  prevMediaUsageStates?: Array<{
    assetId: string;
    accountId: string;
    prevLastUsedAt: string | null;
    claimedLastUsedAt: string;
  }>;
  /** Claim d'usage DataEntry posé au submit (Phase 4) — revert on failure. */
  prevDataUsageState?: {
    entryId: string;
    accountId: string;
    prevLastUsedAt: string | null;
    claimedLastUsedAt: string;
  };
  /** DataLibrary cursor snapshot for failure-recovery revert (Phase 1.3) */
  prevDataLibraryCursorState?: {
    libraryId: string;
    accountId: string;
    prevLastUsedSetTag: string | null;
    prevLastUsedCategory: string | null;
    claimedSetTag: string | null;
    claimedCategory: string | null;
  };
}

export interface CursorRevertState {
  prevCursor: number;
  claimedCursor: number;
  prevLastUsedCategory: string | null;
  claimedLastUsedCategory: string | null;
  /** Phase 6 — snapshot lastUsedSetTag so the CAS revert covers concurrent setTag-only changes. */
  prevLastUsedSetTag: string | null;
  claimedLastUsedSetTag: string | null;
  cursorAccountId?: string;
}

export async function recordLibraryUsage(renderId: string): Promise<void> {
  let render;
  try {
    render = await prisma.render.findUnique({
      where: { id: renderId },
      select: { usedAssets: true, status: true, accountId: true },
    });
  } catch (err) {
    console.error(`[recordLibraryUsage] Failed to fetch render ${renderId}:`, err);
    return;
  }

  if (!render || render.status !== "DONE") return;

  let usedAssets: UsedAssets = {};
  try {
    usedAssets = JSON.parse(render.usedAssets) as UsedAssets;
  } catch (err) {
    console.error(`[recordLibraryUsage] malformed usedAssets JSON for render ${renderId}:`, err);
    return;
  }

  const now = new Date();

  // Filet de détection : un rendu qui consomme une bibliothèque en rotation
  // `theme_sequence` sans compte n'écrira aucune ligne `MediaAssetUsage`
  // (toutes les écritures par compte sont conditionnées à `accountId`). L'asset
  // reste alors « jamais utilisé » côté compte et ressort en tête de rotation.
  // `POST /api/renders` refuse désormais ce cas pour les libs `per_account`, ce
  // log couvre les rendus créés par d'autres chemins (retry, jobs internes).
  if (!render.accountId && usedAssets.setSequencedLibraryIds?.length) {
    console.error(
      `[recordLibraryUsage] render=${renderId} sans accountId alors qu'il consomme ${usedAssets.setSequencedLibraryIds.length} bibliothèque(s) en rotation — aucun MediaAssetUsage ne sera écrit.`,
    );
  }

  // --- Video assets ---
  // Chaque (mediaAsset.update + mediaAssetUsage.upsert) est wrappé dans une
  // transaction par assetId. Sans ça, deux webhooks DONE concurrents sur le
  // même asset pouvaient sous-compter : la branche `create` des deux upserts
  // voyait un état no-row, l'une gagnait à 1, l'autre patchait avec un
  // increment incorrect → usageCount=2 alors qu'un seul render avait consommé
  // l'asset (finding library-11). La tx sérialise la paire.
  const videoAssetIds = Object.values(usedAssets.videoAssets ?? {});
  if (videoAssetIds.length > 0) {
    const accountId = render.accountId;
    const videoResults = await Promise.allSettled(
      videoAssetIds.map(async (assetId) => {
        await prisma.$transaction(async (tx) => {
          await tx.mediaAsset.update({
            where: { id: assetId },
            data: { usageCount: { increment: 1 }, lastUsedAt: now },
          });
          if (accountId) {
            await tx.mediaAssetUsage.upsert({
              where: { assetId_accountId: { assetId, accountId } },
              update: { usageCount: { increment: 1 }, lastUsedAt: now },
              create: { assetId, accountId, usageCount: 1, lastUsedAt: now },
            });
          }
        });
      }),
    );
    for (const [i, result] of videoResults.entries()) {
      if (result.status === "rejected") {
        console.error(
          `[recordLibraryUsage] video asset usage update failed for assetId=${videoAssetIds[i]} render=${renderId}:`,
          result.reason,
        );
      }
    }
  }

  // --- Audio asset ---
  if (usedAssets.audioAssetId) {
    const audioAssetId = usedAssets.audioAssetId;
    const accountId = render.accountId;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.mediaAsset.update({
          where: { id: audioAssetId },
          data: { usageCount: { increment: 1 }, lastUsedAt: now },
        });
        if (accountId) {
          await tx.mediaAssetUsage.upsert({
            where: { assetId_accountId: { assetId: audioAssetId, accountId } },
            update: { usageCount: { increment: 1 }, lastUsedAt: now },
            create: { assetId: audioAssetId, accountId, usageCount: 1, lastUsedAt: now },
          });
        }
      });
    } catch (err) {
      console.error("[recordLibraryUsage] audio asset update/upsert failed:", err);
    }
  }

  // --- Data entry ---
  // Tous les writes liés à l'entry (global update + per-account upsert +
  // shared sentinel upsert) dans une seule tx pour cohérence atomique : un
  // crash en milieu de chemin laissait un état inconsistant (ex: global
  // incrémenté mais per-account ou shared manquants → ordonnancement biaisé).
  if (usedAssets.dataEntryId) {
    const dataEntryId = usedAssets.dataEntryId;
    const accountId = render.accountId;
    try {
      // Lecture rotationScope avant la tx pour éviter une lecture+write
      // entrelacée dans la tx interactive (Prisma ne supporte pas le
      // pattern findUnique dans la même tx que les upserts qui suivent).
      // Phase 4 : scope lu depuis la lib directe ; `usedInCycle` n'est plus écrit
      // (cycles décommissionnés — burn = usageCount).
      const entry = await prisma.dataEntry.findUnique({
        where: { id: dataEntryId },
        select: { library: { select: { rotationScope: true } } },
      });
      const isShared = entry?.library?.rotationScope === "shared";

      await prisma.$transaction(async (tx) => {
        await tx.dataEntry.update({
          where: { id: dataEntryId },
          data: {
            usageCount: { increment: 1 },
            lastUsedAt: now,
          },
        });
        if (accountId) {
          await tx.dataEntryUsage.upsert({
            where: { entryId_accountId: { entryId: dataEntryId, accountId } },
            // For perAccountUsage claim: row exists with usageCount=0 — increment to 1.
            // For no claim: create with usageCount=1.
            update: { usageCount: { increment: 1 }, lastUsedAt: now },
            create: { entryId: dataEntryId, accountId, usageCount: 1, lastUsedAt: now },
          });
        }
        // Pour les DataLibrary en `shared` scope, mirror exactement le pattern
        // MediaAsset — on écrit AUSSI une DataEntryUsage row keyed par
        // SHARED_DATA_USAGE_ACCOUNT_ID. Sans ça, selectDataEntry qui ordonne
        // par LEFT JOIN DataEntryUsage avec effectiveCursorId = sentinel ne
        // voit jamais d'usage et re-pioche toujours les mêmes entries.
        if (isShared) {
          await tx.dataEntryUsage.upsert({
            where: { entryId_accountId: { entryId: dataEntryId, accountId: SHARED_DATA_USAGE_ACCOUNT_ID } },
            update: { usageCount: { increment: 1 }, lastUsedAt: now },
            create: { entryId: dataEntryId, accountId: SHARED_DATA_USAGE_ACCOUNT_ID, usageCount: 1, lastUsedAt: now },
          });
        }
      });
    } catch (err) {
      console.error("[recordLibraryUsage] data entry usage update/upsert failed:", err);
    }
  }

  // --- Set sequence cursors ---
  // Cursor position and lastUsedCategory were already written at prefill time by
  // selectMediaAssetBySetSequence (SELECT FOR UPDATE, serialized across concurrent
  // generations). Here we only stamp lastAdvancedAt to mark render completion.
  //
  // For shared-scope libraries the cursor row is keyed by SHARED_USAGE_ACCOUNT_ID
  // rather than the real accountId; we also write MediaAssetUsage rows keyed by
  // SHARED_USAGE_ACCOUNT_ID so pickFromGroup can rotate within groups globally.
  const seqLibraryIds = usedAssets.setSequencedLibraryIds ?? [];
  if (seqLibraryIds.length > 0) {
    // Plan simplification Phase 3 : plus d'AccountLibraryCursor à stamper —
    // l'ancienneté des dossiers vit entièrement dans MediaAssetUsage.
    const libs = await prisma.mediaLibrary.findMany({
      where: { id: { in: seqLibraryIds } },
      select: { id: true, rotationScope: true },
    });
    const sharedSeqLibIds = new Set(libs.filter((l) => l.rotationScope === "shared").map((l) => l.id));

    // For video assets from shared-scope folder-draw libraries, write a MediaAssetUsage row
    // keyed by SHARED_USAGE_ACCOUNT_ID so within-folder ordering is globally shared.
    if (sharedSeqLibIds.size > 0 && videoAssetIds.length > 0) {
      const assetLibraries = await prisma.mediaAsset.findMany({
        where: { id: { in: videoAssetIds } },
        select: { id: true, libraryId: true },
      });
      const sharedAssetIds = assetLibraries
        .filter((a) => sharedSeqLibIds.has(a.libraryId))
        .map((a) => a.id);
      for (const assetId of sharedAssetIds) {
        await prisma.mediaAssetUsage
          .upsert({
            where: { assetId_accountId: { assetId, accountId: SHARED_USAGE_ACCOUNT_ID } },
            update: { usageCount: { increment: 1 }, lastUsedAt: now },
            create: { assetId, accountId: SHARED_USAGE_ACCOUNT_ID, usageCount: 1, lastUsedAt: now },
          })
          .catch((err: unknown) =>
            console.error(`[recordLibraryUsage] shared asset usage upsert failed assetId=${assetId}:`, err),
          );
      }
    }
  }

  // W5.12 — log de synthèse à la fin pour observability. Avant : aucun signal
  // explicite que recordLibraryUsage a fini ; si une partie a échoué dans une
  // section .catch silencieuse, l'admin ne savait pas que les counters
  // étaient inconsistants. Le log inclut le renderId pour correlation.
  console.info(
    `[recordLibraryUsage] render=${renderId} done — videoAssets=${videoAssetIds.length} audio=${usedAssets.audioAssetId ? 1 : 0} dataEntry=${usedAssets.dataEntryId ? 1 : 0} setSeqLibs=${seqLibraryIds.length}`,
  );
}

// ─── Admin revert ─────────────────────────────────────────────────────────────

export interface RevertAssetResult {
  assetId: string;
  type: "video" | "audio" | "dataEntry";
  usageCountBefore: number;
  usageCountAfter: number;
  lastUsedAtNulled: boolean;
}

export interface RevertCursorResult {
  libraryId: string;
  reverted: boolean;
  /** Set when the cursor could not be reverted (another generation already advanced it). */
  skippedReason?: string;
}

export interface RevertSummary {
  renderId: string;
  assets: RevertAssetResult[];
  cursors: RevertCursorResult[];
  warnings: string[];
}

/**
 * revertRenderUsage — admin-initiated full rollback of a DONE render's library consumption.
 *
 * Decrements usageCount on every asset/entry used by this render, clears lastUsedAt when
 * the count reaches zero, and attempts a conditional revert of BOTH rotation cursors using
 * the snapshots stored in Render.usedAssets at prefill/submit time:
 * - AccountLibraryCursor (media set-sequence) via prevCursorStateByLibrary
 * - AccountDataLibraryCursor (data set/category) via prevDataLibraryCursorState
 *
 * Limitations:
 * - lastUsedAt is only cleared when usageCount reaches 0; prior values are not recoverable.
 * - usedInCycle is only reset when usageCount reaches 0 — an entry shared across several
 *   renders stays flagged after reverting a single render.
 * - Cursor revert is conditional (CAS): if a later generation has already advanced the cursor,
 *   the revert is a no-op and `reverted=false` is returned so the admin UI can surface a warning.
 */
export async function revertRenderUsage(renderId: string): Promise<RevertSummary> {
  const summary: RevertSummary = { renderId, assets: [], cursors: [], warnings: [] };

  const render = await prisma.render.findUnique({
    where: { id: renderId },
    select: { usedAssets: true, status: true, accountId: true },
  });

  if (!render) throw new Error(`Render ${renderId} introuvable`);
  if (render.status !== "DONE") throw new Error(`Le render ${renderId} n'est pas DONE (status=${render.status})`);
  if (!render.accountId) {
    summary.warnings.push("Pas d'accountId sur ce render — les curseurs et usages per-account ne seront pas revertés.");
  }

  let usedAssets: UsedAssets = {};
  try {
    usedAssets = JSON.parse(render.usedAssets as string) as UsedAssets;
  } catch {
    throw new Error(`usedAssets JSON invalide pour le render ${renderId}`);
  }

  const accountId = render.accountId ?? null;

  // Helper: decrement a MediaAsset + its per-account MediaAssetUsage row
  async function revertMediaAsset(assetId: string, type: "video" | "audio"): Promise<void> {
    try {
      const asset = await prisma.mediaAsset.findUnique({
        where: { id: assetId },
        select: { usageCount: true, lastUsedAt: true },
      });
      if (!asset) {
        summary.warnings.push(`Asset ${assetId} introuvable — ignoré.`);
        return;
      }
      const newCount = Math.max(0, asset.usageCount - 1);
      const nullLastUsed = newCount === 0 && asset.lastUsedAt !== null;
      await prisma.mediaAsset.update({
        where: { id: assetId },
        data: {
          usageCount: newCount,
          ...(nullLastUsed ? { lastUsedAt: null } : {}),
        },
      });
      summary.assets.push({
        assetId,
        type,
        usageCountBefore: asset.usageCount,
        usageCountAfter: newCount,
        lastUsedAtNulled: nullLastUsed,
      });
      if (accountId) {
        const usage = await prisma.mediaAssetUsage.findUnique({
          where: { assetId_accountId: { assetId, accountId } },
          select: { usageCount: true },
        });
        if (usage) {
          const newUsageCount = Math.max(0, usage.usageCount - 1);
          await prisma.mediaAssetUsage.update({
            where: { assetId_accountId: { assetId, accountId } },
            data: {
              usageCount: newUsageCount,
              ...(newUsageCount === 0 ? { lastUsedAt: null } : {}),
            },
          });
        }
      }
    } catch (err) {
      summary.warnings.push(`Échec du revert pour l'asset ${assetId}: ${String(err)}`);
    }
  }

  // --- Video assets ---
  for (const assetId of Object.values(usedAssets.videoAssets ?? {})) {
    await revertMediaAsset(assetId, "video");
  }

  // --- Audio asset ---
  if (usedAssets.audioAssetId) {
    await revertMediaAsset(usedAssets.audioAssetId, "audio");
  }

  // --- Data entry ---
  if (usedAssets.dataEntryId) {
    const entryId = usedAssets.dataEntryId;
    try {
      const entry = await prisma.dataEntry.findUnique({
        where: { id: entryId },
        select: { usageCount: true, lastUsedAt: true },
      });
      if (!entry) {
        summary.warnings.push(`DataEntry ${entryId} introuvable — ignoré.`);
      } else {
        const newCount = Math.max(0, entry.usageCount - 1);
        const nullLastUsed = newCount === 0 && entry.lastUsedAt !== null;
        await prisma.dataEntry.update({
          where: { id: entryId },
          data: {
            usageCount: newCount,
            ...(nullLastUsed ? { lastUsedAt: null } : {}),
            ...(newCount === 0 ? { usedInCycle: false } : {}),
          },
        });
        summary.assets.push({
          assetId: entryId,
          type: "dataEntry",
          usageCountBefore: entry.usageCount,
          usageCountAfter: newCount,
          lastUsedAtNulled: nullLastUsed,
        });
        if (accountId) {
          const entryUsage = await prisma.dataEntryUsage.findUnique({
            where: { entryId_accountId: { entryId, accountId } },
            select: { usageCount: true },
          });
          if (entryUsage) {
            const newUsageCount = Math.max(0, entryUsage.usageCount - 1);
            await prisma.dataEntryUsage.update({
              where: { entryId_accountId: { entryId, accountId } },
              data: {
                usageCount: newUsageCount,
                ...(newUsageCount === 0 ? { lastUsedAt: null } : {}),
              },
            });
          }
        }

        // Phase W2.7 — Pour les DataLibrary en scope `shared`, recordLibraryUsage
        // écrit une ligne supplémentaire DataEntryUsage keyed par SHARED_DATA_
        // CURSOR_ACCOUNT_ID. Sans ce revert miroir, la sentinel restait avec
        // usageCount > 0 → l'ordering shared continuait à dé-prioriser cette
        // entry malgré le rollback admin (finding library-8 / rotation-10).
        try {
          const lib = await prisma.dataEntry.findUnique({
            where: { id: entryId },
            select: { campaign: { select: { library: { select: { rotationScope: true } } } } },
          });
          if (lib?.campaign?.library?.rotationScope === "shared") {
            const sharedUsage = await prisma.dataEntryUsage.findUnique({
              where: {
                entryId_accountId: { entryId, accountId: SHARED_DATA_USAGE_ACCOUNT_ID },
              },
              select: { usageCount: true },
            });
            if (sharedUsage) {
              const newSharedCount = Math.max(0, sharedUsage.usageCount - 1);
              await prisma.dataEntryUsage.update({
                where: {
                  entryId_accountId: { entryId, accountId: SHARED_DATA_USAGE_ACCOUNT_ID },
                },
                data: {
                  usageCount: newSharedCount,
                  ...(newSharedCount === 0 ? { lastUsedAt: null } : {}),
                },
              });
            }
          }
        } catch (sharedErr) {
          summary.warnings.push(
            `Échec du revert shared sentinel DataEntry ${entryId}: ${String(sharedErr)}`,
          );
        }
      }
    } catch (err) {
      summary.warnings.push(`Échec du revert pour la DataEntry ${entryId}: ${String(err)}`);
    }
  }

  // --- AccountLibraryCursor revert (LEGACY, renders pré-simplification) ---
  // Depuis la Phase 3 (dossiers simples), les nouveaux renders n'ont plus de
  // snapshot de curseur : l'absence de prevCursorStateByLibrary est normale.
  // Le bloc ne sert plus qu'aux renders en vol créés avant le deploy — à
  // supprimer avec le drop de la table AccountLibraryCursor (N+1).
  const prevStateMap = usedAssets.prevCursorStateByLibrary;
  if (prevStateMap && Object.keys(prevStateMap).length > 0 && accountId) {
    for (const [libraryId, state] of Object.entries(prevStateMap)) {
      try {
        // Use the cursorAccountId stored at prefill time (handles shared libs that use
        // SHARED_USAGE_ACCOUNT_ID as their cursor key instead of the real accountId).
        const cursorAccountId = state.cursorAccountId ?? accountId;
        // Phase 6 : ajout lastUsedSetTag dans SET + condition CAS.
        // Évite d'écraser un prefill concurrent qui aurait modifié uniquement
        // lastUsedSetTag (override mode, sans toucher lastUsedCategory).
        const updated = await prisma.$executeRaw(Prisma.sql`
          UPDATE "AccountLibraryCursor"
          SET
            cursor               = ${state.prevCursor},
            "lastUsedCategory"   = ${state.prevLastUsedCategory},
            "lastUsedSetTag"     = ${state.prevLastUsedSetTag},
            "lastAdvancedAt"     = NULL
          WHERE "accountId"  = ${cursorAccountId}
            AND "libraryId"  = ${libraryId}
            AND cursor IS NOT DISTINCT FROM ${state.claimedCursor}
            AND "lastUsedCategory" IS NOT DISTINCT FROM ${state.claimedLastUsedCategory}
            AND "lastUsedSetTag" IS NOT DISTINCT FROM ${state.claimedLastUsedSetTag}
        `);
        if (updated > 0) {
          summary.cursors.push({ libraryId, reverted: true });
          console.info(
            `[revertRenderUsage] render=${renderId} library=${libraryId} cursor reverted ${state.claimedCursor}→${state.prevCursor}`,
          );
        } else {
          summary.cursors.push({
            libraryId,
            reverted: false,
            skippedReason:
              "Le curseur a déjà été avancé par une génération suivante — revert non appliqué pour éviter de perturber la rotation.",
          });
          console.warn(
            `[revertRenderUsage] render=${renderId} library=${libraryId} cursor NOT reverted (already advanced by a later generation)`,
          );
        }
      } catch (err) {
        summary.cursors.push({ libraryId, reverted: false, skippedReason: String(err) });
        summary.warnings.push(`Échec du revert de curseur pour la bibliothèque ${libraryId}: ${String(err)}`);
      }
    }
  }

  // --- AccountDataLibraryCursor revert ---
  // Symétrique au curseur média ci-dessus : revert CAS du curseur de la
  // DataLibrary (lastUsedSetTag / lastUsedCategory / lastAdvancedAt) vers le
  // snapshot prevDataLibraryCursorState posé au submit. Sans ce bloc, un revert
  // admin laissait le curseur data avancé d'un cran sur les compteurs déjà
  // rembobinés → le groupe reverté était sauté à la génération suivante
  // (selectEligibleDataGroups l'exclut comme lastUsedSetTag/lastUsedCategory) au
  // lieu d'être ré-offert. Le chemin ERROR (revertLibraryCursors) le faisait
  // déjà ; seul le chemin admin l'oubliait.
  const dataLibState = usedAssets.prevDataLibraryCursorState;
  if (dataLibState) {
    try {
      // L'accountId vient du snapshot (effectiveCursorId au submit) : vrai
      // accountId, ou SHARED_DATA_USAGE_ACCOUNT_ID pour les libs en scope
      // shared. On ne se base donc PAS sur render.accountId ici.
      const updated = await prisma.$executeRaw(Prisma.sql`
        UPDATE "AccountDataLibraryCursor"
        SET "lastUsedSetTag"   = ${dataLibState.prevLastUsedSetTag},
            "lastUsedCategory" = ${dataLibState.prevLastUsedCategory},
            "lastAdvancedAt"   = NULL
        WHERE "accountId" = ${dataLibState.accountId}
          AND "libraryId" = ${dataLibState.libraryId}
          AND "lastUsedSetTag"   IS NOT DISTINCT FROM ${dataLibState.claimedSetTag}
          AND "lastUsedCategory" IS NOT DISTINCT FROM ${dataLibState.claimedCategory}
      `);
      if (updated > 0) {
        summary.cursors.push({ libraryId: dataLibState.libraryId, reverted: true });
        console.info(
          `[revertRenderUsage] render=${renderId} DataLibrary=${dataLibState.libraryId} cursor reverted`,
        );
      } else {
        summary.cursors.push({
          libraryId: dataLibState.libraryId,
          reverted: false,
          skippedReason:
            "Le curseur data a déjà été avancé par une génération suivante — revert non appliqué pour éviter de perturber la rotation.",
        });
        console.warn(
          `[revertRenderUsage] render=${renderId} DataLibrary=${dataLibState.libraryId} cursor NOT reverted (already advanced by a later generation)`,
        );
      }
    } catch (err) {
      summary.cursors.push({ libraryId: dataLibState.libraryId, reverted: false, skippedReason: String(err) });
      summary.warnings.push(
        `Échec du revert du curseur data pour la bibliothèque ${dataLibState.libraryId}: ${String(err)}`,
      );
    }
  }

  return summary;
}

/**
 * revertLibraryCursors — called when a render reaches status=ERROR.
 *
 * Uses a conditional UPDATE to roll back the cursor that was advanced at prefill time,
 * but only if no subsequent generation has since written a newer value.
 * This ensures a failed render's claimed content slot becomes available again on the next
 * run, restoring the normal rotation cycle.
 *
 * Safety: best-effort, non-throwing.  If the condition doesn't match (another gen already
 * advanced past this claim), the update is a harmless no-op.
 */
export async function revertLibraryCursors(renderId: string): Promise<void> {
  let render;
  try {
    render = await prisma.render.findUnique({
      where: { id: renderId },
      select: { usedAssets: true, accountId: true },
    });
  } catch (err) {
    console.error(`[revertLibraryCursors] Failed to fetch render ${renderId}:`, err);
    return;
  }

  if (!render?.usedAssets) return;

  let usedAssets: UsedAssets = {};
  try {
    usedAssets = JSON.parse(render.usedAssets as string) as UsedAssets;
  } catch {
    return;
  }

  const accountId = render.accountId;
  const prevStateMap = usedAssets.prevCursorStateByLibrary;

  // Cursor revert — only when accountId and prevStateMap are both present.
  // DataEntry and audio reverts below run independently of this condition.
  if (accountId && prevStateMap && Object.keys(prevStateMap).length > 0) {
    await Promise.allSettled(
      Object.entries(prevStateMap).map(async ([libraryId, state]) => {
        try {
          // Use the cursorAccountId stored at prefill time (handles shared libs that use
          // SHARED_USAGE_ACCOUNT_ID as their cursor key instead of the real accountId).
          const cursorAccountId = state.cursorAccountId ?? accountId;
          // Conditional revert: only apply if the cursor row still reflects exactly what
          // this generation wrote.  If a concurrent or later generation has since advanced
          // the cursor, the WHERE won't match and the update is a no-op.
          // Phase 6 : ajout lastUsedSetTag dans SET + condition CAS.
          // Phase W2.6 : on remet aussi lastAdvancedAt=NULL pour annuler la
          // "history" du compte. Sans ça, après un ERROR + revert, le prochain
          // prefill voyait hasHistory=true (lastAdvancedAt non-null) et
          // appliquait une exclusion catégorie comme si une gen avait
          // réellement abouti — finding rotation-10.
          const updated = await prisma.$executeRaw(Prisma.sql`
            UPDATE "AccountLibraryCursor"
            SET
              cursor               = ${state.prevCursor},
              "lastUsedCategory"   = ${state.prevLastUsedCategory},
              "lastUsedSetTag"     = ${state.prevLastUsedSetTag},
              "lastAdvancedAt"     = NULL
            WHERE "accountId"  = ${cursorAccountId}
              AND "libraryId"  = ${libraryId}
              AND cursor IS NOT DISTINCT FROM ${state.claimedCursor}
              AND "lastUsedCategory" IS NOT DISTINCT FROM ${state.claimedLastUsedCategory}
              AND "lastUsedSetTag" IS NOT DISTINCT FROM ${state.claimedLastUsedSetTag}
          `);
          if (updated > 0) {
            console.info(`[revertLibraryCursors] render=${renderId} library=${libraryId} cursor reverted ${state.claimedCursor}→${state.prevCursor}`);
          } else {
            // No-op : un autre process a déjà avancé le cursor entre-temps.
            // On log explicitement pour ne pas confondre avec un succès en
            // post-mortem (finding rotation-5).
            console.info(`[revertLibraryCursors] render=${renderId} library=${libraryId} cursor NOT reverted (already advanced by a later generation)`);
          }
        } catch (err) {
          console.error(`[revertLibraryCursors] revert failed for render=${renderId} library=${libraryId}:`, err);
        }
      }),
    );
  }

  // --- DataEntry claim revert ---
  const dataState = usedAssets.prevDataEntryState;
  if (dataState) {
    try {
      if (dataState.claimType === "usedInCycle") {
        // Claimed via usedInCycle=true. Revert only if usageCount=0 (DONE never ran).
        const updated = await prisma.$executeRaw(Prisma.sql`
          UPDATE "DataEntry"
          SET "usedInCycle" = false
          WHERE id = ${dataState.entryId}
            AND "usageCount" = 0
            AND "usedInCycle" = true
        `);
        if (updated > 0) {
          console.info(`[revertLibraryCursors] render=${renderId} DataEntry=${dataState.entryId} usedInCycle reverted`);
        }
      } else if (dataState.claimType === "perAccountUsage" && dataState.accountId) {
        // Claimed via DataEntryUsage(usageCount=0) insert. Delete only if still at 0.
        const deleted = await prisma.$executeRaw(Prisma.sql`
          DELETE FROM "DataEntryUsage"
          WHERE "entryId"   = ${dataState.entryId}
            AND "accountId" = ${dataState.accountId}
            AND "usageCount" = 0
        `);
        if (deleted > 0) {
          console.info(`[revertLibraryCursors] render=${renderId} DataEntry=${dataState.entryId} perAccountUsage claim deleted`);
        }
      }
    } catch (err) {
      console.error(`[revertLibraryCursors] DataEntry revert failed for render=${renderId}:`, err);
    }
  }

  // --- Video usage claims revert (Phase 3 dossiers) ---
  // Même CAS optimiste que l'audio ci-dessous : on n'annule le stamp
  // lastUsedAt posé au submit que si la ligne n'a pas bougé depuis.
  for (const state of usedAssets.prevMediaUsageStates ?? []) {
    try {
      const prevTs = state.prevLastUsedAt ? new Date(state.prevLastUsedAt) : null;
      const claimedTs = new Date(state.claimedLastUsedAt);
      const updated = await prisma.$executeRaw(Prisma.sql`
        UPDATE "MediaAssetUsage"
        SET "lastUsedAt" = ${prevTs}
        WHERE "assetId"   = ${state.assetId}
          AND "accountId" = ${state.accountId}
          AND "lastUsedAt" IS NOT DISTINCT FROM ${claimedTs}
      `);
      if (updated > 0) {
        console.info(
          `[revertLibraryCursors] render=${renderId} video assetId=${state.assetId} lastUsedAt reverted`,
        );
      }
    } catch (err) {
      console.error(`[revertLibraryCursors] video usage revert failed for render=${renderId}:`, err);
    }
  }

  // --- Data usage claim revert (Phase 4 dossiers) ---
  if (usedAssets.prevDataUsageState) {
    const state = usedAssets.prevDataUsageState;
    try {
      const prevTs = state.prevLastUsedAt ? new Date(state.prevLastUsedAt) : null;
      const claimedTs = new Date(state.claimedLastUsedAt);
      const updated = await prisma.$executeRaw(Prisma.sql`
        UPDATE "DataEntryUsage"
        SET "lastUsedAt" = ${prevTs}
        WHERE "entryId"   = ${state.entryId}
          AND "accountId" = ${state.accountId}
          AND "lastUsedAt" IS NOT DISTINCT FROM ${claimedTs}
      `);
      if (updated > 0) {
        console.info(
          `[revertLibraryCursors] render=${renderId} data entryId=${state.entryId} lastUsedAt reverted`,
        );
      }
    } catch (err) {
      console.error(`[revertLibraryCursors] data usage revert failed for render=${renderId}:`, err);
    }
  }

  // --- Audio usage claim revert ---
  // We only undo the prefill-time lastUsedAt stamp if the row hasn't been touched
  // since (optimistic concurrency via the claimedLastUsedAt sentinel value).
  const audioState = usedAssets.prevAudioUsageState;
  if (audioState) {
    try {
      const prevTs = audioState.prevLastUsedAt ? new Date(audioState.prevLastUsedAt) : null;
      const claimedTs = new Date(audioState.claimedLastUsedAt);
      const updated = await prisma.$executeRaw(Prisma.sql`
        UPDATE "MediaAssetUsage"
        SET "lastUsedAt" = ${prevTs}
        WHERE "assetId"   = ${audioState.assetId}
          AND "accountId" = ${audioState.accountId}
          AND "lastUsedAt" IS NOT DISTINCT FROM ${claimedTs}
      `);
      if (updated > 0) {
        console.info(
          `[revertLibraryCursors] render=${renderId} audio assetId=${audioState.assetId} lastUsedAt reverted`,
        );
      }
    } catch (err) {
      console.error(`[revertLibraryCursors] audio revert failed for render=${renderId}:`, err);
    }
  }

  // --- DataLibrary cursor revert (Phase 1.3) ---
  // Conditional: revert only if no later generation has since advanced the cursor.
  const dataLibState = usedAssets.prevDataLibraryCursorState;
  if (dataLibState) {
    try {
      const updated = await prisma.$executeRaw(Prisma.sql`
        UPDATE "AccountDataLibraryCursor"
        SET "lastUsedSetTag"   = ${dataLibState.prevLastUsedSetTag},
            "lastUsedCategory" = ${dataLibState.prevLastUsedCategory},
            "lastAdvancedAt"   = NULL
        WHERE "accountId" = ${dataLibState.accountId}
          AND "libraryId" = ${dataLibState.libraryId}
          AND "lastUsedSetTag"   IS NOT DISTINCT FROM ${dataLibState.claimedSetTag}
          AND "lastUsedCategory" IS NOT DISTINCT FROM ${dataLibState.claimedCategory}
      `);
      if (updated > 0) {
        console.info(
          `[revertLibraryCursors] render=${renderId} DataLibrary=${dataLibState.libraryId} cursor reverted`,
        );
      }
    } catch (err) {
      console.error(`[revertLibraryCursors] DataLibrary cursor revert failed for render=${renderId}:`, err);
    }
  }
}
