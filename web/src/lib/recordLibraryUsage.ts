/**
 * recordLibraryUsage.ts
 *
 * Called after a Render reaches status=DONE. Reads `render.usedAssets` and
 * atomically increments usage counters on the relevant MediaAssets and DataEntry.
 *
 * Design: best-effort — errors are logged but do not throw (render already succeeded).
 */

import { prisma } from "@/lib/prisma";

interface UsedAssets {
  /** blockId → assetId */
  videoAssets?: Record<string, string>;
  audioAssetId?: string;
  dataEntryId?: string;
}

export async function recordLibraryUsage(renderId: string): Promise<void> {
  let render;
  try {
    render = await prisma.render.findUnique({
      where: { id: renderId },
      select: { usedAssets: true, status: true },
    });
  } catch (err) {
    console.error(`[recordLibraryUsage] Failed to fetch render ${renderId}:`, err);
    return;
  }

  if (!render || render.status !== "DONE") return;

  let usedAssets: UsedAssets = {};
  try {
    usedAssets = JSON.parse(render.usedAssets) as UsedAssets;
  } catch {
    return;
  }

  const now = new Date();

  // --- Video assets ---
  const videoAssetIds = Object.values(usedAssets.videoAssets ?? {});
  if (videoAssetIds.length > 0) {
    await Promise.allSettled(
      videoAssetIds.map((assetId) =>
        prisma.mediaAsset.update({
          where: { id: assetId },
          data: { usageCount: { increment: 1 }, lastUsedAt: now },
        }),
      ),
    );
  }

  // --- Audio asset ---
  if (usedAssets.audioAssetId) {
    await prisma.mediaAsset
      .update({
        where: { id: usedAssets.audioAssetId },
        data: { usageCount: { increment: 1 }, lastUsedAt: now },
      })
      .catch((err: unknown) => console.error("[recordLibraryUsage] audio asset update failed:", err));
  }

  // --- Data entry ---
  if (usedAssets.dataEntryId) {
    await prisma.dataEntry
      .update({
        where: { id: usedAssets.dataEntryId },
        data: { usageCount: { increment: 1 }, lastUsedAt: now, usedInCycle: true },
      })
      .catch((err: unknown) => console.error("[recordLibraryUsage] data entry update failed:", err));
  }
}
