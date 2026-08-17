import type { PublicationSlot } from "@/types/calendar";

/**
 * Slot "prêt à programmer" : possède un montage courant (currentVersionId) ET
 * un statut finalisable. Source unique partagée entre BankView (vue banque) et
 * BankRail (rail latéral drag→jour) pour éviter la dérive de définition.
 */
export function isReadyToSchedule(slot: PublicationSlot): boolean {
  if (!slot.currentVersionId) return false;
  return (
    slot.status === "EDIT_APPROVED" ||
    slot.status === "READY_FOR_CM"
  );
}
