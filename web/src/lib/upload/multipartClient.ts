/**
 * Helper client réutilisable pour l'upload multipart vers R2 (compatible S3).
 *
 * Découpe un fichier en parties et les PUT vers des URLs pré-signées, avec
 * concurrence limitée + retries. Les ETags ne sont PAS lus côté client : ils
 * sont relus côté serveur via ListParts à la finalisation (cf.
 * `lib/r2Multipart.ts` → `completeMultipartUpload`). En cross-origin, l'ETag de
 * la réponse PUT n'est de toute façon lisible que si la CORS du bucket expose
 * `ETag`, ce qui n'est pas garanti.
 *
 * Extrait de la logique inline de `MediaDropzone.tsx` pour être partagé par les
 * flux transcription et captions (uploads > 5 Go, où le PUT unique R2 échoue).
 */

const DEFAULT_CONCURRENCY = 4;
const MAX_RETRIES = 3;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** PUT d'une partie avec retries (backoff exponentiel). */
async function uploadPartWithRetry(
  url: string,
  chunk: Blob,
  signal: AbortSignal,
  attempt = 0,
): Promise<void> {
  try {
    const res = await fetch(url, {
      method: "PUT",
      body: chunk,
      signal,
      headers: { "Content-Type": "application/octet-stream" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    if (attempt >= MAX_RETRIES - 1) throw err;
    if (signal.aborted) throw err;
    await delay(Math.pow(2, attempt) * 500);
    return uploadPartWithRetry(url, chunk, signal, attempt + 1);
  }
}

/**
 * Uploade un fichier en plusieurs parties vers des URLs pré-signées.
 *
 * @param file       Le fichier (ou Blob) à découper.
 * @param partUrls   URLs pré-signées, une par partie (1-based, ordre quelconque).
 * @param partSize   Taille d'une partie en octets (la dernière est tronquée).
 * @param opts       signal d'annulation, callback de progression (fraction 0→1),
 *                   concurrence max (défaut 4).
 * @returns Les parties uploadées, triées par numéro — à passer au serveur pour
 *          le CompleteMultipartUpload.
 */
export async function uploadFileInParts(
  file: Blob,
  partUrls: { partNumber: number; url: string }[],
  partSize: number,
  opts: { signal: AbortSignal; onProgress?: (fraction: number) => void; concurrency?: number },
): Promise<{ partNumber: number }[]> {
  const { signal, onProgress, concurrency = DEFAULT_CONCURRENCY } = opts;
  const total = partUrls.length;
  const done: { partNumber: number }[] = [];
  let completed = 0;

  const queue = [...partUrls];
  const workers = Array.from({ length: Math.min(concurrency, total) }, async () => {
    while (queue.length > 0) {
      const part = queue.shift()!;
      const start = (part.partNumber - 1) * partSize;
      const end = Math.min(start + partSize, file.size);
      const chunk = file.slice(start, end);

      await uploadPartWithRetry(part.url, chunk, signal);

      done.push({ partNumber: part.partNumber });
      completed += 1;
      onProgress?.(completed / total);
    }
  });

  await Promise.all(workers);

  return done.sort((a, b) => a.partNumber - b.partNumber);
}
