/**
 * Taille réelle du fichier d'un MediaAsset (colonne `sizeBytes`).
 *
 * Lue à la source : HEAD R2, ou disque en stockage local — derrière
 * `asset.url` (public/uploads), jamais derrière `r2Key`.
 */

import { prisma } from "@/lib/prisma";
import { headR2Object } from "@/lib/r2";
import { isLocalStorage, localFileSizeForUrl } from "@/lib/storage";

/**
 * Taille en octets du fichier d'un asset, null s'il est introuvable.
 * Throw sur une erreur réseau persistante (au caller de décider).
 */
export async function statMediaAssetFile(asset: {
  r2Key: string;
  url: string;
}): Promise<number | null> {
  if (isLocalStorage()) return localFileSizeForUrl(asset.url);
  const head = await headR2Object(asset.r2Key);
  return head ? head.contentLength : null;
}

/**
 * Taille après une réécriture du fichier (media_edit) — best-effort pour les
 * webhooks : ne throw jamais, null si inconnue (l'export client la recalcule).
 */
export async function readEditedAssetSize(assetId: string): Promise<bigint | null> {
  try {
    const asset = await prisma.mediaAsset.findUnique({
      where: { id: assetId },
      select: { r2Key: true, url: true },
    });
    if (!asset) return null;
    const size = await statMediaAssetFile(asset);
    return size == null ? null : BigInt(size);
  } catch (err) {
    console.warn(`[assetSize] taille illisible pour asset=${assetId} :`, err);
    return null;
  }
}
