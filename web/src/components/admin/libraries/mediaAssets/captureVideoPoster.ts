/**
 * captureVideoPoster — extrait une frame d'une vidéo locale en image JPEG
 * légère (canvas), destinée à servir de vignette/poster.
 *
 * Best-effort : retourne `null` si la capture échoue (codec non décodable par
 * le navigateur, timeout, dimensions nulles). L'appelant ne doit JAMAIS bloquer
 * l'upload sur cet échec — la grille retombe simplement sur un <video>.
 */
export async function captureVideoPoster(
  file: File,
  opts?: { atSeconds?: number; maxWidth?: number; quality?: number },
): Promise<Blob | null> {
  const atSeconds = opts?.atSeconds ?? 0.5;
  const maxWidth = opts?.maxWidth ?? 320;
  const quality = opts?.quality ?? 0.6;

  return new Promise((resolve) => {
    let settled = false;
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "metadata";
    // crossOrigin inutile (objectURL local), mais évite tout taint éventuel.
    video.src = url;

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      try {
        video.load();
      } catch {
        /* ignore */
      }
    };
    const finish = (blob: Blob | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve(blob);
    };
    const timer = setTimeout(() => finish(null), 10000);

    video.onloadedmetadata = () => {
      const dur = video.duration;
      // Seek à atSeconds, borné à la moitié de la durée pour les clips courts.
      const target =
        isFinite(dur) && dur > 0 ? Math.min(atSeconds, dur / 2) : atSeconds;
      video.currentTime = target > 0 ? target : 0;
    };

    video.onseeked = () => {
      if (settled) return;
      try {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (!w || !h) {
          finish(null);
          return;
        }
        const scale = Math.min(1, maxWidth / w);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          finish(null);
          return;
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => finish(blob), "image/jpeg", quality);
      } catch {
        finish(null);
      }
    };

    video.onerror = () => finish(null);
  });
}
