/**
 * Helper "version finale" d'un slot de publication.
 *
 * Pour un slot avec captions générées (CaptionJob COMPLETED + outputUrl),
 * la vidéo qui doit être affichée / publiée / prévisualisée est la version
 * AVEC captions (`captionJob.outputUrl`), pas la vidéo brute du render.
 *
 * Pour les slots sans captions (pattern.needsCaptions = false) ou avec
 * captions en cours / échec, on retombe sur `render.videoUrl`.
 *
 * Cette logique est centralisée pour éviter les divergences entre les vues
 * (PublicationHeader, PublishSection, RenderSection, /renders/[id], etc.)
 * qui doivent toutes pointer vers la même "version finale".
 */

// ─── Types minimaux (pour découpler du type Prisma complet) ──────────────────

interface SlotWithFinalVideoInputs {
  render: { videoUrl: string | null } | null;
  /**
   * Dernier CaptionJob lié au slot (orderBy createdAt desc, take 1).
   * Si le job est COMPLETED et a un `outputUrl`, c'est lui qui prime.
   */
  latestCaptionJob?: { status: string; outputUrl: string | null } | null;
}

/**
 * Retourne l'URL vidéo "finale" du slot (avec captions si dispo, sinon brute).
 * Renvoie `null` si aucune vidéo n'est encore disponible.
 */
export function getSlotFinalVideoUrl(slot: SlotWithFinalVideoInputs): string | null {
  const captionUrl = slot.latestCaptionJob?.status === "COMPLETED"
    ? slot.latestCaptionJob.outputUrl
    : null;
  return captionUrl ?? slot.render?.videoUrl ?? null;
}

/**
 * Indique si la vidéo finale est la version sous-titrée (vs. la version brute).
 * Utile pour afficher un badge "Avec sous-titres" dans la preview.
 */
export function isFinalVideoCaptioned(slot: SlotWithFinalVideoInputs): boolean {
  return Boolean(
    slot.latestCaptionJob?.status === "COMPLETED" && slot.latestCaptionJob.outputUrl,
  );
}
