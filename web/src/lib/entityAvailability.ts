/**
 * Disponibilité du vidéaste sur une fiche de tournage.
 *
 * Un seul prédicat, consommé par les TROIS surfaces qui posent la question :
 * le bandeau de la fiche (`EntityFiche`), la worklist `/home` du vidéaste
 * (`ShootAvailabilityStrip`) et l'inbox admin (`getInboxItems`). Le partage
 * n'est pas cosmétique : c'est exactement la recopie à la main d'un filtre
 * d'équipe sur trois sites qui a produit le bug de scoping — corrigé sur aucun
 * des trois pendant des mois, parce que personne ne savait qu'ils existaient.
 *
 * Module PUR (ni Prisma ni React) : c'est ce qui permet au composant client de
 * l'importer plutôt que de réimplémenter la condition.
 */

import { isValidatedForTeam } from "@/lib/permissions/entityScope";

/** Réponse du vidéaste : `null` = la question est encore ouverte. */
export type VideasteConfirmation = "CONFIRMED" | "DECLINED" | null;

export interface AvailabilityCandidate {
  hasPlanning: boolean;
  status: string | null;
  isArchived: boolean;
  validationStatus: string | null;
  videasteConfirmation: string | null;
}

/**
 * Vrai si « es-tu disponible ? » est encore une question ouverte.
 *
 * Les gardes `isValidatedForTeam` et `!isArchived` sont indispensables ici et
 * ne figuraient pas dans l'ancienne condition inline : tant que le scope
 * d'équipe était cassé, aucun vidéaste n'atteignait jamais une fiche non
 * validée, ce qui masquait le trou. Maintenant qu'il voit ses fiches, le
 * serveur refuserait (`ConflictError`, entityService) une réponse sur une
 * fiche non validée — afficher le bandeau promettrait une action impossible.
 *
 * AUCUNE garde de date, volontairement : un tournage passé jamais confirmé
 * reste une question ouverte, et c'est même le cas le plus urgent à traiter.
 */
export function needsVideasteAnswer(entity: AvailabilityCandidate): boolean {
  return (
    entity.hasPlanning &&
    !entity.isArchived &&
    isValidatedForTeam(entity.validationStatus) &&
    // `status` nullable = fiche jamais sortie de son état initial (PLANNED).
    (entity.status ?? "PLANNED") === "PLANNED" &&
    entity.videasteConfirmation !== "CONFIRMED"
  );
}

/** Le tournage a déjà eu lieu : la formulation du bandeau change. */
export function isPastShoot(scheduledAt: Date | string | null, now: Date = new Date()): boolean {
  if (!scheduledAt) return false;
  return new Date(scheduledAt).getTime() < now.getTime();
}

/** Longueur max d'un motif d'indisponibilité (texte libre, rôle non-admin). */
export const MAX_DECLINE_REASON = 500;
