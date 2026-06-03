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
import { SHARED_CURSOR_ACCOUNT_ID } from "@/lib/contentLibraryResolver";

interface UsedAssets {
  /** blockId → assetId */
  videoAssets?: Record<string, string>;
  audioAssetId?: string;
  dataEntryId?: string;
  /** Libraries that used set_sequence — cursor/lastUsedSetTag will be updated */
  setSequencedLibraryIds?: string[];
  /** libraryId → resolved setTag used during this generation */
  usedSetTagByLibrary?: Record<string, string>;
  /** libraryId → resolved category used during this generation */
  usedCategoryByLibrary?: Record<string, string>;
  /** libraryId → cursor snapshot for failure-recovery revert */
  prevCursorStateByLibrary?: Record<string, {
    prevCursor: number;
    claimedCursor: number;
    prevLastUsedCategory: string | null;
    claimedLastUsedCategory: string | null;
    cursorAccountId?: string;
  }>;
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

  // --- Video assets ---
  const videoAssetIds = Object.values(usedAssets.videoAssets ?? {});
  if (videoAssetIds.length > 0) {
    const accountId = render.accountId;
    const videoResults = await Promise.allSettled(
      videoAssetIds.map(async (assetId) => {
        // Always update global aggregate
        await prisma.mediaAsset.update({
          where: { id: assetId },
          data: { usageCount: { increment: 1 }, lastUsedAt: now },
        });
        // Upsert per-account usage when accountId is present
        if (accountId) {
          await prisma.mediaAssetUsage.upsert({
            where: { assetId_accountId: { assetId, accountId } },
            update: { usageCount: { increment: 1 }, lastUsedAt: now },
            create: { assetId, accountId, usageCount: 1, lastUsedAt: now },
          });
        }
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
    await prisma.mediaAsset
      .update({
        where: { id: audioAssetId },
        data: { usageCount: { increment: 1 }, lastUsedAt: now },
      })
      .catch((err: unknown) => console.error("[recordLibraryUsage] audio asset update failed:", err));
    if (accountId) {
      await prisma.mediaAssetUsage
        .upsert({
          where: { assetId_accountId: { assetId: audioAssetId, accountId } },
          update: { usageCount: { increment: 1 }, lastUsedAt: now },
          create: { assetId: audioAssetId, accountId, usageCount: 1, lastUsedAt: now },
        })
        .catch((err: unknown) => console.error("[recordLibraryUsage] audio asset usage upsert failed:", err));
    }
  }

  // --- Data entry ---
  if (usedAssets.dataEntryId) {
    const dataEntryId = usedAssets.dataEntryId;
    const accountId = render.accountId;
    const claimType = usedAssets.prevDataEntryState?.claimType;
    await prisma.dataEntry
      .update({
        where: { id: dataEntryId },
        data: {
          usageCount: { increment: 1 },
          lastUsedAt: now,
          // usedInCycle was already set at prefill for "usedInCycle" claim types.
          // For "perAccountUsage" and fallback (no claim), set it here on DONE.
          ...(claimType === "usedInCycle" ? {} : { usedInCycle: true }),
        },
      })
      .catch((err: unknown) => console.error("[recordLibraryUsage] data entry update failed:", err));
    if (accountId) {
      await prisma.dataEntryUsage
        .upsert({
          where: { entryId_accountId: { entryId: dataEntryId, accountId } },
          // For perAccountUsage claim: row exists with usageCount=0 — increment to 1.
          // For no claim: create with usageCount=1.
          update: { usageCount: { increment: 1 }, lastUsedAt: now },
          create: { entryId: dataEntryId, accountId, usageCount: 1, lastUsedAt: now },
        })
        .catch((err: unknown) => console.error("[recordLibraryUsage] data entry usage upsert failed:", err));
    }
  }

  // --- Set sequence cursors ---
  // Cursor position and lastUsedCategory were already written at prefill time by
  // selectMediaAssetBySetSequence (SELECT FOR UPDATE, serialized across concurrent
  // generations). Here we only stamp lastAdvancedAt to mark render completion.
  //
  // For shared-scope libraries the cursor row is keyed by SHARED_CURSOR_ACCOUNT_ID
  // rather than the real accountId; we also write MediaAssetUsage rows keyed by
  // SHARED_CURSOR_ACCOUNT_ID so pickFromGroup can rotate within groups globally.
  const seqLibraryIds = usedAssets.setSequencedLibraryIds ?? [];
  const accountId = render.accountId;
  if (seqLibraryIds.length > 0) {
    const libs = await prisma.mediaLibrary.findMany({
      where: { id: { in: seqLibraryIds } },
      select: { id: true, rotationScope: true },
    });
    const scopeMap = new Map(libs.map((l) => [l.id, l.rotationScope ?? "per_account"]));
    const sharedSeqLibIds = new Set(libs.filter((l) => l.rotationScope === "shared").map((l) => l.id));

    await Promise.allSettled(
      seqLibraryIds.map(async (libraryId) => {
        const isShared = scopeMap.get(libraryId) === "shared";
        const cursorAccountId = isShared ? SHARED_CURSOR_ACCOUNT_ID : accountId;
        if (!cursorAccountId) return; // no accountId for per-account library — skip
        try {
          await prisma.accountLibraryCursor.upsert({
            where: { accountId_libraryId: { accountId: cursorAccountId, libraryId } },
            update: { lastAdvancedAt: now },
            create: { accountId: cursorAccountId, libraryId, cursor: 0, lastAdvancedAt: now },
          });
        } catch (err) {
          console.error(`[recordLibraryUsage] cursor lastAdvancedAt update failed for library ${libraryId}:`, err);
        }
      }),
    );

    // For video assets from shared-scope set-sequence libraries, write a MediaAssetUsage row
    // keyed by SHARED_CURSOR_ACCOUNT_ID so within-group rotation ordering is globally shared.
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
            where: { assetId_accountId: { assetId, accountId: SHARED_CURSOR_ACCOUNT_ID } },
            update: { usageCount: { increment: 1 }, lastUsedAt: now },
            create: { assetId, accountId: SHARED_CURSOR_ACCOUNT_ID, usageCount: 1, lastUsedAt: now },
          })
          .catch((err: unknown) =>
            console.error(`[recordLibraryUsage] shared asset usage upsert failed assetId=${assetId}:`, err),
          );
      }
    }
  }
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
 * the count reaches zero, and attempts a conditional cursor revert using the prevCursorState
 * snapshot stored in Render.usedAssets at prefill time.
 *
 * Limitations:
 * - lastUsedAt is only cleared when usageCount reaches 0; prior values are not recoverable.
 * - AccountLibraryCursor.lastUsedSetTag is not included in the snapshot and is not reverted.
 * - Cursor revert is conditional: if a later generation has already advanced the cursor, the
 *   revert is a no-op and `reverted=false` is returned so the admin UI can surface a warning.
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
      }
    } catch (err) {
      summary.warnings.push(`Échec du revert pour la DataEntry ${entryId}: ${String(err)}`);
    }
  }

  // --- AccountLibraryCursor revert ---
  const prevStateMap = usedAssets.prevCursorStateByLibrary;
  if (!prevStateMap || Object.keys(prevStateMap).length === 0) {
    if ((usedAssets.setSequencedLibraryIds ?? []).length > 0) {
      summary.warnings.push(
        "Ce render utilise des bibliothèques set-sequence mais ne contient pas de snapshot de curseur (render ancien). Les curseurs ne peuvent pas être revertés.",
      );
    }
  } else if (accountId) {
    for (const [libraryId, state] of Object.entries(prevStateMap)) {
      try {
        // Use the cursorAccountId stored at prefill time (handles shared libs that use
        // SHARED_CURSOR_ACCOUNT_ID as their cursor key instead of the real accountId).
        const cursorAccountId = state.cursorAccountId ?? accountId;
        const updated = await prisma.$executeRaw(Prisma.sql`
          UPDATE "AccountLibraryCursor"
          SET
            cursor               = ${state.prevCursor},
            "lastUsedCategory"   = ${state.prevLastUsedCategory},
            "lastAdvancedAt"     = NULL
          WHERE "accountId"  = ${cursorAccountId}
            AND "libraryId"  = ${libraryId}
            AND cursor IS NOT DISTINCT FROM ${state.claimedCursor}
            AND "lastUsedCategory" IS NOT DISTINCT FROM ${state.claimedLastUsedCategory}
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
          // SHARED_CURSOR_ACCOUNT_ID as their cursor key instead of the real accountId).
          const cursorAccountId = state.cursorAccountId ?? accountId;
          // Conditional revert: only apply if the cursor row still reflects exactly what
          // this generation wrote.  If a concurrent or later generation has since advanced
          // the cursor, the WHERE won't match and the update is a no-op.
          const updated = await prisma.$executeRaw(Prisma.sql`
            UPDATE "AccountLibraryCursor"
            SET
              cursor               = ${state.prevCursor},
              "lastUsedCategory"   = ${state.prevLastUsedCategory}
            WHERE "accountId"  = ${cursorAccountId}
              AND "libraryId"  = ${libraryId}
              AND cursor IS NOT DISTINCT FROM ${state.claimedCursor}
              AND "lastUsedCategory" IS NOT DISTINCT FROM ${state.claimedLastUsedCategory}
          `);
          if (updated > 0) {
            console.info(`[revertLibraryCursors] render=${renderId} library=${libraryId} cursor reverted ${state.claimedCursor}→${state.prevCursor}`);
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
