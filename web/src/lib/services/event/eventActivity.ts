/**
 * Wrapper centralisé pour logger les événements d'activité d'un ShootEvent dans
 * ShootEventActivity.
 *
 * Table dédiée (≠ PublicationActivity, dont `slotId` est NOT NULL). Même
 * contrat que `logActivity` (slot) : tolérant aux erreurs, accepte un tx client.
 */

import type { PrismaClient, Prisma } from "@prisma/client";

export type ShootEventActivityType =
  | "EVENT_CREATED"
  | "EVENT_UPDATED"
  | "EVENT_STATUS_CHANGED"
  | "EVENT_RUSHES_UPLOADED"
  | "EVENT_RUSHES_DELETED"
  | "EVENT_SHOT"
  | "EVENT_REEL_ATTACHED"
  | "EVENT_CANCELLED"
  | "EVENT_DONE";

export interface LogEventActivityInput {
  eventId: string;
  /** null si l'acteur est le système. */
  actorId: string | null;
  type: ShootEventActivityType;
  payload?: Record<string, unknown>;
}

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Crée une entrée ShootEventActivity.
 *
 * @returns L'objet créé `{ id }` ou `null` si l'insert a échoué.
 */
export async function logEventActivity(
  prisma: DbClient,
  input: LogEventActivityInput,
): Promise<{ id: string } | null> {
  try {
    const created = await prisma.shootEventActivity.create({
      data: {
        eventId: input.eventId,
        actorId: input.actorId,
        type: input.type,
        payload: (input.payload ?? undefined) as Prisma.InputJsonValue | undefined,
      },
      select: { id: true },
    });
    return created;
  } catch (err) {
    console.warn(
      `[logEventActivity] Échec insert activité (type=${input.type}, eventId=${input.eventId}) :`,
      err,
    );
    return null;
  }
}
