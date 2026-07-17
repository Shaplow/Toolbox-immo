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
  | "CAPTIONS_PIPELINE_RETRIGGERED"
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
  | "CLIENT_VALIDATION_CANCELLED"
  // ── Cover frame pack lifecycle (Cohérence Workflows Phase 2) ──────────────
  | "COVER_QUEUED"
  | "COVER_READY"
  | "COVER_FAILED"
  | "COVER_CONFIG_ERROR"
  // ── Banque de contenus (slots stockés sans date programmée) ───────────────
  /** Slot créé en lot dans la banque (sans date programmée). */
  | "BANK_SLOT_CREATED"
  /** Slot banque promu en publication datée (transition scheduledAt null → date). */
  | "BANK_SLOT_SCHEDULED"
  /** Légende pré-remplie depuis le bien rattaché (mode description "preFilled"). */
  | "DESCRIPTION_PREFILLED";

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
// Accepte PrismaClient OU TransactionClient pour permettre l'usage intra-tx
// (cf. fix audit 2026-05-30 M5 : logActivity dans la même transaction que
// l'insert métier, garantit l'atomicité audit + action).
type DbClient = PrismaClient | Prisma.TransactionClient;

export async function logActivity(
  prisma: DbClient,
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
