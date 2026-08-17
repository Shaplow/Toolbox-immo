/**
 * Helper partagé pour charger une fiche (Entity) avec les champs nécessaires
 * au scoping d'accès (`canUserAccessEntity` / `canUploadEntityRushes`).
 * Port Phase 5 de `event/eventRushAccess.ts` — évite de dupliquer le `select`
 * d'accès dans les routes rushs et les pages.
 */

import { prisma } from "@/lib/prisma";

export const ENTITY_ACCESS_SELECT = {
  id: true,
  type: { select: { visibility: true } },
  assigneeVideasteId: true,
  defaultAssigneeMonteurId: true,
  defaultAssigneeCmId: true,
  shootSlots: { select: { assigneeMonteurId: true, assigneeCmId: true } },
} as const;

export type EntityAccess = {
  id: string;
  type: { visibility: string };
  assigneeVideasteId: string | null;
  defaultAssigneeMonteurId: string | null;
  defaultAssigneeCmId: string | null;
  shootSlots: Array<{ assigneeMonteurId: string | null; assigneeCmId: string | null }>;
};

/** Charge la fiche pour un check d'accès, ou null si elle n'existe pas. */
export async function loadEntityForAccess(entityId: string): Promise<EntityAccess | null> {
  return prisma.entity.findUnique({
    where: { id: entityId },
    select: ENTITY_ACCESS_SELECT,
  });
}
