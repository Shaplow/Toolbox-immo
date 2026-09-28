/**
 * renderEligibility — éligibilité au lancement de rendu, côté client.
 *
 * Mêmes règles que le service serveur (`lib/services/render/bulkRenderService.ts`,
 * previewBulkRenders) pour que le compteur de l'en-tête calendrier et l'icône
 * de statut sur `SlotCard` comptent exactement les mêmes publications que ce
 * que la modale « Lancer les rendus » listera comme `ready`.
 *
 * Typé STRUCTURELLEMENT (champs minimaux, tous optionnels) plutôt que sur le
 * type client `PublicationSlot` : le service serveur réutilise ces fonctions
 * sur ses propres formes (Slot Prisma, ligne d'aperçu…) sans dépendre d'un
 * type UI.
 */

import { TERMINAL_STATUSES } from "@/types/roles";

export interface RenderEligibilityInput {
  status: string;
  /** Rendu courant du slot — ne pointe que sur `currentRenderId` (promu à DONE). */
  render?: { status: string } | null;
  /** Dernier Render créé, promu ou pas — seul signal d'un rendu en vol ou en échec. */
  latestRender?: { status: string } | null;
  pattern?: { source?: string | null; templateId?: string | null } | null;
}

/** Rendu courant DONE, ou dernier rendu connu DONE (course SSE/promotion). */
export function isRendered(s: RenderEligibilityInput): boolean {
  return s.render?.status === "DONE" || s.latestRender?.status === "DONE";
}

/**
 * Un rendu est en file ou en cours de traitement — pas encore de résultat.
 * `isRendered` prime : un rendu PROCESSING suivi d'un DONE plus récent (race)
 * n'est plus « en vol ».
 */
export function isRenderInFlight(s: RenderEligibilityInput): boolean {
  if (isRendered(s)) return false;
  const st = s.latestRender?.status;
  return st === "PENDING" || st === "PROCESSING";
}

/**
 * Le dernier rendu connu s'est terminé en erreur, et rien de plus récent n'a
 * réussi depuis. Reste vrai même si un `render` courant existe (cas
 * « Relancer » sur une publication jamais rendue avec succès).
 */
export function hasRenderFailed(s: RenderEligibilityInput): boolean {
  return !isRendered(s) && s.latestRender?.status === "ERROR";
}

/**
 * Candidat au lancement de rendu (bouton bulk de l'en-tête calendrier, icône
 * de carte) : recette `auto_template` avec template builder, statut non
 * terminal, pas déjà rendu, pas déjà en vol. Un rendu courant en ERROR reste
 * candidat — c'est exactement le cas « Relancer ».
 */
export function isRenderCandidate(s: RenderEligibilityInput): boolean {
  if (s.pattern?.source !== "auto_template") return false;
  if (!s.pattern.templateId) return false;
  if ((TERMINAL_STATUSES as readonly string[]).includes(s.status)) return false;
  if (isRendered(s)) return false;
  if (isRenderInFlight(s)) return false;
  return true;
}
