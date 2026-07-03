/**
 * createFromR2.ts
 *
 * Helper serveur : copie la sortie d'un render R2 dans une bibliothèque de médias
 * en tant que MediaAsset "generated".
 *
 * Non bloquant — appelé en fire-and-forget depuis le trigger autoSaveToLibrary.
 * Ne throw jamais : toute erreur est loguée et la fonction retourne null.
 */

import { prisma } from "@/lib/prisma";
import {
  getFromR2,
  uploadToR2,
  getR2PublicUrl,
  r2Configured,
} from "@/lib/r2";
import type { MediaAsset } from "@prisma/client";

const CAPTIONS_API = process.env.CAPTIONS_API_URL ?? "http://localhost:8000";
const DEST_KEY_PREFIX = "content-library/videos";

// ─── Helpers privés ───────────────────────────────────────────────────────────

/**
 * Extrait la clé R2 depuis une URL publique R2.
 * Si `sourceUrlOrKey` n'est pas une URL (pas de "http"), retourne l'entrée
 * directement en supposant que c'est déjà une clé R2.
 */
function extractR2Key(sourceUrlOrKey: string): string {
  if (sourceUrlOrKey.startsWith("http")) {
    try {
      return new URL(sourceUrlOrKey).pathname.slice(1);
    } catch {
      return sourceUrlOrKey;
    }
  }
  return sourceUrlOrKey;
}

/**
 * Probe la durée d'une vidéo via le render-engine local.
 * Best-effort : retourne null si le render-engine est absent ou renvoie une erreur.
 * Aligné sur `probeDurationFromRenderEngine` dans confirm/route.ts.
 */
async function probeDuration(url: string): Promise<number | null> {
  if (!CAPTIONS_API) return null;
  try {
    const res = await fetch(`${CAPTIONS_API}/api/probe-duration`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(35_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { duration?: number | null };
    return typeof data.duration === "number" && data.duration > 0
      ? data.duration
      : null;
  } catch {
    return null;
  }
}

// ─── Interface publique ───────────────────────────────────────────────────────

export interface CreateMediaAssetFromR2Options {
  libraryId: string;
  /** URL publique R2 ou clé R2 directe du render source. */
  sourceUrlOrKey: string;
  /** ID du render source — clé de déduplication + traçabilité. */
  renderId: string;
  tags?: string[];
  setTag?: string;
}

/**
 * Copie un fichier render R2 dans la bibliothèque de médias cible et crée un
 * MediaAsset "generated" en base de données.
 *
 * Clé de destination déterministe : `content-library/videos/mission-{renderId}.mp4`
 *
 * Idempotence :
 *   1. Cherche un asset existant avec `sourceRenderId === renderId` avant toute opération.
 *   2. Si la contrainte unique sur `r2Key` déclenche une P2002 (race concurrente),
 *      retourne l'asset existant retrouvé par `sourceRenderId`.
 *
 * Best-effort :
 *   - Bibliothèque inexistante ou non-"video" → log warning + retourne null.
 *   - Erreur R2 read/write → log error + retourne null.
 *   - Probe durée échouée → asset créé sans durée (non bloquant pour la rotation).
 *
 * @returns L'asset créé ou existant, null en cas d'erreur non-récupérable.
 */
export async function createMediaAssetFromR2({
  libraryId,
  sourceUrlOrKey,
  renderId,
  tags,
  setTag,
}: CreateMediaAssetFromR2Options): Promise<MediaAsset | null> {
  if (!r2Configured()) {
    console.warn(
      `[createFromR2] R2 non configuré — skip auto-save renderId=${renderId}`,
    );
    return null;
  }

  // 1. Idempotence : asset déjà créé pour ce render ?
  const existing = await prisma.mediaAsset.findFirst({
    where: { sourceRenderId: renderId },
  });
  if (existing) {
    console.info(
      `[createFromR2] Asset déjà existant (id=${existing.id}) pour renderId=${renderId} — skip`,
    );
    return existing;
  }

  // 2. Valider la bibliothèque cible (existence + type)
  const library = await prisma.mediaLibrary.findUnique({
    where: { id: libraryId },
    select: { id: true, type: true, name: true },
  });
  if (!library) {
    console.warn(
      `[createFromR2] Bibliothèque cible introuvable (id=${libraryId}) pour renderId=${renderId} — skip`,
    );
    return null;
  }
  if (library.type !== "video") {
    console.warn(
      `[createFromR2] Bibliothèque cible "${library.name}" (id=${libraryId}) n'est pas de type "video" (type="${library.type}") — skip pour renderId=${renderId}`,
    );
    return null;
  }

  // 3. Dériver la clé R2 source depuis l'URL ou la clé directe
  const sourceKey = extractR2Key(sourceUrlOrKey);
  const destKey = `${DEST_KEY_PREFIX}/mission-${renderId}.mp4`;

  // 4. Copie R2 : get source → upload destination
  //    Pas de copyObject disponible dans les helpers R2 → get + re-upload.
  let buffer: Buffer;
  try {
    buffer = await getFromR2(sourceKey);
  } catch (err) {
    console.error(
      `[createFromR2] Échec lecture R2 source key="${sourceKey}" pour renderId=${renderId}:`,
      err,
    );
    return null;
  }

  let destUrl: string;
  try {
    const uploaded = await uploadToR2(destKey, buffer, "video/mp4", buffer.byteLength);
    destUrl = uploaded.url;
  } catch (err) {
    // Si l'upload échoue mais la clé existe déjà (race R2), construire quand même l'URL
    // déterministe pour continuer. Une P2002 Prisma côté base sera catch plus bas.
    console.warn(
      `[createFromR2] Upload R2 vers destKey="${destKey}" pour renderId=${renderId} (tentative de récupération) : ${String(err)}`,
    );
    destUrl = getR2PublicUrl(destKey);
  }

  // 5. Probe durée (best-effort via render-engine)
  const duration = await probeDuration(destUrl);
  if (duration == null) {
    console.warn(
      `[createFromR2] Durée introuvable pour renderId=${renderId} url=${destUrl} — asset créé sans durée`,
    );
  }

  // 6. Créer le MediaAsset en base
  const filename = `mission-${renderId}.mp4`;
  try {
    const asset = await prisma.mediaAsset.create({
      data: {
        libraryId,
        filename,
        r2Key: destKey,
        url: destUrl,
        mimeType: "video/mp4",
        duration: duration ?? null,
        tags: JSON.stringify(tags ?? []),
        setTag: setTag ?? null,
        source: "generated",
        sourceRenderId: renderId,
      },
    });
    console.info(
      `[createFromR2] Asset id=${asset.id} créé dans library="${library.name}" (id=${libraryId}) pour renderId=${renderId}`,
    );
    return asset;
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e?.code === "P2002") {
      // Course concurrente sur r2Key ou sourceRenderId — l'autre appel a gagné.
      const dup = await prisma.mediaAsset.findFirst({
        where: { sourceRenderId: renderId },
      });
      if (dup) {
        console.info(
          `[createFromR2] Race condition (P2002) résolue — asset existant id=${dup.id} pour renderId=${renderId}`,
        );
        return dup;
      }
      console.warn(
        `[createFromR2] P2002 mais asset introuvable par sourceRenderId=${renderId}`,
      );
      return null;
    }
    console.error(
      `[createFromR2] Erreur création MediaAsset pour renderId=${renderId}:`,
      err,
    );
    return null;
  }
}
