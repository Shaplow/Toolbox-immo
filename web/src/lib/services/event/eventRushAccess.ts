/**
 * Helper partagé pour charger un ShootEvent avec les champs nécessaires au
 * scoping d'accès (upload/list/download des rushs). Évite de dupliquer le
 * `select` d'accès dans les 6 routes rushs de l'événement.
 */

import { prisma } from "@/lib/prisma";

export const EVENT_RUSH_ACCESS_SELECT = {
  id: true,
  assigneeVideasteId: true,
  defaultAssigneeMonteurId: true,
  defaultAssigneeCmId: true,
  slots: { select: { assigneeMonteurId: true, assigneeCmId: true } },
} as const;

export type EventRushAccess = {
  id: string;
  assigneeVideasteId: string | null;
  defaultAssigneeMonteurId: string | null;
  defaultAssigneeCmId: string | null;
  slots: Array<{ assigneeMonteurId: string | null; assigneeCmId: string | null }>;
};

/** Charge l'événement pour un check d'accès rush, ou null s'il n'existe pas. */
export async function loadEventForAccess(eventId: string): Promise<EventRushAccess | null> {
  return prisma.shootEvent.findUnique({
    where: { id: eventId },
    select: EVENT_RUSH_ACCESS_SELECT,
  });
}
