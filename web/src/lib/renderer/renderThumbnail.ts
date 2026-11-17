/**
 * Vignettes des renders image pour « Mes générations ».
 *
 * Les PNG font 1920 px de large (formats écran) et jusqu'à ×3 pour les formats
 * print (≈ 4 760 × 3 370 px pour un A3) — plusieurs Mo avec une vraie photo :
 * impossible de les afficher tels quels dans une liste. La vignette est faite à
 * la première demande puis gardée à côté du PNG, ce qui couvre tout
 * l'historique sans script de rattrapage.
 */
import { readFile, rename, unlink, writeFile } from "fs/promises";
import path from "path";
import sharp from "sharp";
import { createLimiter } from "@/lib/concurrency";
import { captureError } from "@/lib/observability/captureError";
import { RENDERS_DIR } from "./renderPaths";
import { localRenderPngFilename } from "./renderThumbnailUrl";

const THUMBNAIL_WIDTH = 480;
const THUMBNAIL_QUALITY = 72;
const RENDER_ID = /^[A-Za-z0-9_-]+$/;

/**
 * Deux décodages au plus à la fois : un PNG A3 en ×3 pèse ~64 Mo décompressé, et
 * une page de 20 lignes demande ses vignettes d'un coup au process unique.
 * Singleton global pour survivre au rechargement à chaud en dev.
 */
const globalForThumbnails = globalThis as unknown as {
  __renderThumbnailLimiter?: <T>(fn: () => Promise<T>) => Promise<T>;
};
function thumbnailLimiter(): <T>(fn: () => Promise<T>) => Promise<T> {
  globalForThumbnails.__renderThumbnailLimiter ??= createLimiter(2);
  return globalForThumbnails.__renderThumbnailLimiter;
}

async function readIfExists(filePath: string): Promise<Buffer | null> {
  try {
    return await readFile(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Vignette WebP du render, générée au besoin. Null si le render n'a pas de PNG
 * local ou si le fichier a disparu du disque.
 */
export async function getRenderThumbnail(
  renderId: string,
  pngUrl: string | null,
): Promise<Buffer | null> {
  const pngFilename = localRenderPngFilename(pngUrl);
  if (!pngFilename || !RENDER_ID.test(renderId)) return null;

  const thumbnailPath = path.join(RENDERS_DIR, `${renderId}.thumb.webp`);
  const cached = await readIfExists(thumbnailPath);
  if (cached) return cached;

  return thumbnailLimiter()(async () => {
    // Une requête parallèle a pu la faire pendant l'attente dans la file.
    const madeMeanwhile = await readIfExists(thumbnailPath);
    if (madeMeanwhile) return madeMeanwhile;

    const source = await readIfExists(path.join(RENDERS_DIR, pngFilename));
    if (!source) return null;

    const thumbnail = await sharp(source)
      .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
      .webp({ quality: THUMBNAIL_QUALITY })
      .toBuffer();

    // Écriture atomique : une lecture concurrente ne voit jamais un fichier à moitié écrit.
    // Un cache qui échoue n'empêche pas de servir la vignette, il oblige seulement à la refaire.
    const tmpPath = `${thumbnailPath}.${process.pid}-${Date.now()}.tmp`;
    try {
      await writeFile(tmpPath, thumbnail);
      await rename(tmpPath, thumbnailPath);
    } catch (err) {
      await unlink(tmpPath).catch(() => undefined);
      captureError(err, { tag: "render-thumbnail-cache", extra: { renderId } });
    }
    return thumbnail;
  });
}
