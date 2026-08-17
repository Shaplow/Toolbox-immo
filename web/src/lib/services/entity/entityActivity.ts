/**
 * Wrapper centralisé pour logger les événements d'activité d'une fiche (Entity)
 * dans EntityActivity — plan simplification Phase 5 (métaobjet).
 *
 * Port de `event/eventActivity.ts` (ShootEventActivity). Table dédiée (≠
 * PublicationActivity, dont `slotId` est NOT NULL). Même contrat : tolérant
 * aux erreurs, accepte un tx client.
 */

import type { PrismaClient, Prisma } from "@prisma/client";

export type EntityActivityType =
  | "CREATED"
  | "UPDATED"
  | "STATUS_CHANGED"
  | "RUSHES_UPLOADED"
  | "RUSHES_DELETED"
  | "SHOT"
  | "SLOT_ATTACHED"
  | "CANCELLED"
  | "DONE";

export interface LogEntityActivityInput {
  entityId: string;
  /** null si l'acteur est le système. */
  actorId: string | null;
  type: EntityActivityType;
  payload?: Record<string, unknown>;
}

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Crée une entrée EntityActivity.
 *
 * @returns L'objet créé `{ id }` ou `null` si l'insert a échoué.
 */
export async function logEntityActivity(
  prisma: DbClient,
  input: LogEntityActivityInput,
): Promise<{ id: string } | null> {
  try {
    const created = await prisma.entityActivity.create({
      data: {
        entityId: input.entityId,
        actorId: input.actorId,
        type: input.type,
        payload: (input.payload ?? undefined) as Prisma.InputJsonValue | undefined,
      },
      select: { id: true },
    });
    return created;
  } catch (err) {
    console.warn(
      `[logEntityActivity] Échec insert activité (type=${input.type}, entityId=${input.entityId}) :`,
      err,
    );
    return null;
  }
}
