/**
 * Wrapper centralisé pour logger les événements d'activité dans PublicationActivity.
 *
 * Conception :
 * - Un seul point d'entrée pour tous les types d'activité (évite la dispersion).
 * - Tolérant aux erreurs : log un warn et retourne null si l'insert échoue,
 *   afin de ne pas casser l'action métier principale à cause d'un log.
 * - Idempotence non garantie : appelez logActivity une seule fois par événement.
 */

import type { PrismaClient, Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Types publics
// ---------------------------------------------------------------------------

export type ActivityType =
  | "STATUS_CHANGED"
  | "ASSIGNEE_CHANGED"
  | "RENDER_COMPLETED"
  | "COVER_COMPLETED"
  | "CAPTIONS_COMPLETED"
  | "DESCRIPTION_COMPLETED"
  | "PUBLISHED"
  | "COMMENT_ADDED"
  // ── Rushes / versions / brief (Phase A3) ──────────────────────────────────
  | "BRIEF_UPDATED"
  | "RUSHES_UPLOADED"
  | "RUSHES_DELETED"
  | "VERSION_UPLOADED"
  | "VERSION_PROMOTED"
  | "VERSION_DELETED"
  | "VERSION_RESTORED"
  | "CURRENT_VERSION_CHANGED"
  // ── Client validation (W2) ────────────────────────────────────────────────
  | "CLIENT_VALIDATION_TOKEN_GENERATED"
  | "CLIENT_VALIDATION_TOKEN_REVOKED"
  | "CLIENT_VALIDATION_APPROVED"
  | "CLIENT_VALIDATION_REJECTED"
  | "CLIENT_VALIDATION_CANCELLED";

export interface LogActivityInput {
  slotId: string;
  /** null si l'acteur est le système (futur cron ou webhook). */
  actorId: string | null;
  type: ActivityType;
  payload?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// logActivity
// ---------------------------------------------------------------------------

/**
 * Crée une entrée PublicationActivity.
 *
 * @returns L'objet créé `{ id }` ou `null` si l'insert a échoué.
 */
export async function logActivity(
  prisma: PrismaClient,
  input: LogActivityInput
): Promise<{ id: string } | null> {
  try {
    const created = await prisma.publicationActivity.create({
      data: {
        slotId: input.slotId,
        actorId: input.actorId,
        type: input.type,
        payload: (input.payload ?? undefined) as Prisma.InputJsonValue | undefined,
      },
      select: { id: true },
    });

    return created;
  } catch (err) {
    console.warn(
      `[logActivity] Échec de l'insert d'activité (type=${input.type}, slotId=${input.slotId}) :`,
      err
    );
    return null;
  }
}
