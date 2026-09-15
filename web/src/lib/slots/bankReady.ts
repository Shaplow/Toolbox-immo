import type { PublicationSlot } from "@/types/calendar";

/**
 * Slot "prêt à programmer" : possède un montage courant (currentVersionId) ET
 * un statut finalisable.
 *
 * N'est PLUS un filtre : le rail « Banque » montre tout le backlog, parce que
 * pré-programmer une publication en attente de rushs est légitime et que rien
 * côté serveur ne l'interdit. Ce prédicat sert désormais de MARQUEUR — bordure
 * d'accent dans le rail, et bascule phase/statut sur la carte du calendrier.
 */
export function isReadyToSchedule(slot: PublicationSlot): boolean {
  if (!slot.currentVersionId) return false;
  return (
    slot.status === "EDIT_APPROVED" ||
    slot.status === "READY_FOR_CM"
  );
}
