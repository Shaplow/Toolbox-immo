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

/**
 * Intervalle entre deux signes de vie envoyés au serveur pendant un upload long.
 * 2 min laisse une marge confortable sous le seuil de 10 min du sweep admin, tout
 * en restant négligeable en nombre de requêtes (30/heure).
 */
const HEARTBEAT_INTERVAL_MS = 120_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fabrique un émetteur de heartbeat throttlé, à brancher sur `onProgress`.
 *
 * Pourquoi piloté par la progression plutôt que par un `setInterval` : il n'y a
 * aucun timer à annuler à la fin de l'upload, ni au démontage du composant, ni en
 * cas d'erreur. Le battement s'arrête naturellement quand les parties cessent
 * d'arriver — donc jamais de requête qui traîne après un upload fini ou annulé.
 *
 * Les échecs sont silencieux **par conception** : un heartbeat est un signal
 * best-effort. Le faire remonter ferait échouer un upload de plusieurs heures pour
 * un simple hoquet réseau sur une requête accessoire.
 *
 * @param url       Route de heartbeat du job (`…/upload-heartbeat`).
 * @param signal    Même signal que l'upload : plus rien n'est émis après annulation.
 * @param everyMs   Intervalle minimal entre deux envois.
 * @returns Une fonction à appeler aussi souvent qu'on veut ; elle n'émet qu'au rythme voulu.
 */
export function createUploadHeartbeat(
  url: string,
  signal: AbortSignal,
  everyMs: number = HEARTBEAT_INTERVAL_MS,
): () => void {
  // Premier battement décalé d'un intervalle : inutile de pinger juste après le
  // prepare, qui vient déjà de toucher `updatedAt` en créant le job.
  let lastSent = Date.now();
  let inFlightSince: number | null = null;

  return () => {
    if (signal.aborted) return;
    const now = Date.now();

    // Garde anti-concurrence, mais **expirable**. Un `fetch` sans timeout peut
    // rester pendant indéfiniment (serveur qui accepte la connexion sans jamais
    // répondre). Avec un simple booléen, ce cas bloquerait tous les heartbeats
    // suivants et le job finirait sweepé — exactement ce qu'on cherche à éviter.
    // Au-delà d'un intervalle, on considère la requête perdue et on réessaie.
    if (inFlightSince !== null && now - inFlightSince >= everyMs) {
      inFlightSince = null;
    }
    if (inFlightSince !== null) return;
    if (now - lastSent < everyMs) return;

    lastSent = now;
    inFlightSince = now;
    void fetch(url, { method: "POST", signal })
      .catch(() => {
        /* best-effort : ne jamais faire échouer l'upload pour un heartbeat */
      })
      .finally(() => {
        inFlightSince = null;
      });
  };
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
