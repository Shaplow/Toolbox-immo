/**
 * Vidéo finale d'une publication : le fichier que le client reconnaît comme
 * « sa » vidéo publiée.
 *
 * Elle peut vivre à trois endroits et aucun helper existant ne les couvre tous
 * (`getSlotFinalVideoUrl` ignore `currentVersion`) ; l'ordre ci-dessous est
 * celui du travail éditorial, du plus abouti au plus brut :
 *
 *   1. caption  — vidéo sous-titrée (CaptionJob terminé, non périmé, pas un aperçu)
 *   2. version  — montage validé par le monteur (currentVersion non supprimée)
 *   3. render   — rendu automatique de la recette (Render « DONE »)
 *
 * Seul un fichier présent sur R2 peut être exporté : l'URL signée est dérivée
 * de la clé. Une vidéo hébergée ailleurs (pipeline local, legacy) est
 * signalée « not_on_r2 » plutôt que perdue en silence.
 *
 * Pur : aucun import serveur (ce module est aussi chargé dans le navigateur).
 */

import type { PublicationVideoSource } from "./types";

export interface SlotFinalVideoInput {
  /**
   * Déjà filtrés par la requête (COMPLETED, staleSince null, previewMode false)
   * et triés du plus récent au plus ancien. Pas de `take: 1` : un job récent
   * sans sortie sur R2 ne doit pas masquer un job éligible plus ancien.
   */
  captionJobs: Array<{ outputKey: string | null; outputUrl: string | null }>;
  currentVersion: {
    r2Key: string;
    fileName: string;
    fileUrl: string;
    fileSizeBytes: number | null;
    deletedAt: Date | string | null;
  } | null;
  render: { status: string; videoUrl: string | null; pngUrl: string | null } | null;
}

export type SlotFinalVideo =
  | {
      ok: true;
      source: PublicationVideoSource;
      r2Key: string;
      /** Stockage local uniquement : URL same-origin du fichier. */
      localUrl: string | null;
      fileName: string | null;
      sizeBytes: number | null;
    }
  | { ok: false; reason: "not_on_r2" | "no_video" | "image_post" };

/** Retire les « / » de queue en temps linéaire (une regex `\/+$` reviendrait en arrière). */
function withoutTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
}

/**
 * Clé R2 d'une URL publique du bucket, ou null si elle pointe ailleurs.
 *
 * Préfixe STRICT `publicUrl + "/"` : un `startsWith(publicUrl)` accepterait
 * « https://cdn.x.com.evil.com/… » pour « https://cdn.x.com ». Query et
 * fragment sont retirés ; la clé n'est pas décodée (les URLs publiques sont
 * construites `${publicUrl}/${key}`, sans encodage).
 */
export function r2KeyFromPublicUrl(url: string | null | undefined, publicUrl: string | null | undefined): string | null {
  if (!url || !publicUrl) return null;
  const origin = withoutTrailingSlashes(publicUrl);
  // Une origine vide ferait de « /uploads/x.mp4 » une clé valide.
  if (!origin) return null;
  const prefix = `${origin}/`;
  if (!url.startsWith(prefix)) return null;

  let key = url.slice(prefix.length);
  for (const separator of ["?", "#"]) {
    const at = key.indexOf(separator);
    if (at !== -1) key = key.slice(0, at);
  }
  return key || null;
}

export function resolveSlotFinalVideo(
  input: SlotFinalVideoInput,
  opts: { publicUrl: string | null; localStorage: boolean },
): SlotFinalVideo {
  // Une vidéo existe mais n'est pas servable depuis R2 : motif d'échec le plus parlant.
  let offR2 = false;

  // 1. Sous-titrée : le plus récent job dont la clé R2 est connue. En stockage
  // local, une sortie sans clé (URL /uploads/…) est ignorée comme une autre.
  for (const job of input.captionJobs) {
    const key = job.outputKey || r2KeyFromPublicUrl(job.outputUrl, opts.publicUrl);
    if (key) return { ok: true, source: "caption", r2Key: key, localUrl: null, fileName: null, sizeBytes: null };
    if (job.outputUrl) offR2 = true;
  }

  // 2. Montage validé. Une version supprimée n'est plus « la » vidéo.
  const version = input.currentVersion;
  if (version && version.deletedAt == null) {
    if (version.r2Key) {
      return {
        ok: true,
        source: "version",
        r2Key: version.r2Key,
        // Le fichier d'un stockage local est derrière fileUrl, pas derrière r2Key.
        localUrl: opts.localStorage ? version.fileUrl || null : null,
        fileName: version.fileName || null,
        sizeBytes: version.fileSizeBytes ?? null,
      };
    }
    offR2 = true;
  }

  // 3. Rendu automatique terminé, hébergé sur l'origine R2.
  const render = input.render;
  if (render && render.status === "DONE" && render.videoUrl) {
    const key = r2KeyFromPublicUrl(render.videoUrl, opts.publicUrl);
    if (key) return { ok: true, source: "render", r2Key: key, localUrl: null, fileName: null, sizeBytes: null };
    offR2 = true;
  }

  // Aucune vidéo exportable : pourquoi ?
  if (render?.pngUrl && !render.videoUrl) return { ok: false, reason: "image_post" };
  if (offR2) return { ok: false, reason: "not_on_r2" };
  return { ok: false, reason: "no_video" };
}
