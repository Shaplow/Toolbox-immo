/**
 * Règle « ce render a-t-il une vignette ? » — module pur, importable côté client :
 * « Mes générations » la réapplique quand le polling fait passer un render à DONE.
 */

/** `pngUrl` d'un render image local, tel qu'écrit par generateRender. */
const LOCAL_PNG_URL = /^\/renders\/([A-Za-z0-9_-]+\.png)$/;

/**
 * Nom du PNG local d'un render, ou null si `pngUrl` ne désigne pas un fichier du
 * dossier des rendus (render vidéo, URL distante). Le motif ne laisse passer
 * aucun séparateur de chemin : le nom renvoyé peut aller tel quel dans `path.join`.
 */
export function localRenderPngFilename(pngUrl: string | null | undefined): string | null {
  const match = pngUrl ? LOCAL_PNG_URL.exec(pngUrl) : null;
  return match ? match[1] : null;
}

/** URL de la vignette d'un render image terminé, ou null s'il n'en a pas. */
export function renderThumbnailUrl(render: {
  id: string;
  status: string;
  pngUrl: string | null;
}): string | null {
  if (render.status !== "DONE" || !localRenderPngFilename(render.pngUrl)) return null;
  return `/api/renders/${render.id}/thumbnail`;
}
