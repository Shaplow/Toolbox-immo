/**
 * Service slot — création, lecture, modification, suppression de PublicationSlot.
 *
 * Pattern :
 * - Une fonction nommée par opération métier (createSlot, patchSlot, ...).
 * - Throw `ServiceError` sur erreur métier (route mappe vers HTTP via `mapServiceError`).
 * - Les routes restent responsables du parsing body, de l'auth basique, du mapping HTTP.
 *
 * Voir `web/src/lib/services/README.md` pour la convention complète.
 */

import { prisma } from "@/lib/prisma";
import type { UserContext } from "@/lib/userContext";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/services/_runtime/errors";

// ─── Types I/O ────────────────────────────────────────────────────────────────

export interface CreateSlotInput {
  accountId: string;
  scheduledAt: string;
  title?: string | null;
  caption?: string | null;
  notes?: string | null;
  templateId?: string | null;
  fields?: Record<string, string>;
  fieldSchema?: string[];
  /** Pattern-based creation (Phase 1.6). Si fourni, les assignees sont préfilés depuis le pattern. */
  patternId?: string | null;
  /** Override admin : les valeurs fournies priment sur le préfill pattern. */
  assigneeMonteurId?: string | null;
  assigneeCmId?: string | null;
  assigneeVideasteId?: string | null;
  // ── Phase 6 : overrides one-off (booleans/strings ou null pour hériter du pattern) ──
  needsCaptionsOverride?: boolean | null;
  needsDescriptionOverride?: string | null;
  needsRushesOverride?: boolean | null;
  needsBriefOverride?: boolean | null;
  coverModeOverride?: string | null;
  // ── Phase 2 (Cohérence Rôles) : pickers preset/prompt one-off ──
  coverPresetIdOverride?: string | null;
  captionPresetIdOverride?: string | null;
  descriptionPromptIdOverride?: string | null;
}

// ─── Helpers privés ───────────────────────────────────────────────────────────

function safeJSON<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}

async function ensureUserExists(userId: string, fieldLabel: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new ValidationError(`${fieldLabel} : utilisateur introuvable`);
  }
}

// ─── createSlot ───────────────────────────────────────────────────────────────

/**
 * Crée un PublicationSlot manuel (admin uniquement).
 *
 * Étapes :
 *  1. Auth : seul un ADMIN réel (canAdminBypass) peut créer. L'impersonation
 *     ne donne pas les droits admin.
 *  2. Résolution pattern → préfill assignees (l'override admin prime).
 *  3. Validation : accountId/scheduledAt requis, account existe, date valide.
 *  4. Validation assignees : les Users référencés doivent exister.
 *  5. Création + retour du slot avec fields/fieldSchema déjà parsés.
 *
 * Throw :
 *  - `ForbiddenError` si l'appelant n'est pas ADMIN réel.
 *  - `ValidationError` si données invalides ou références manquantes.
 *  - `NotFoundError` si le compte Instagram cible n'existe pas.
 */
export async function createSlot(input: CreateSlotInput, ctx: UserContext) {
  // POST réservé aux admins — l'impersonation ne donne pas canAdminBypass.
  if (!ctx.canAdminBypass) {
    throw new ForbiddenError("Réservé aux administrateurs");
  }

  if (!input.accountId || !input.scheduledAt) {
    throw new ValidationError("accountId et scheduledAt sont requis");
  }

  // Résolution pattern → préfill des assignees (l'override admin du body prime).
  let resolvedAssigneeMonteurId: string | null = input.assigneeMonteurId ?? null;
  let resolvedAssigneeCmId: string | null = input.assigneeCmId ?? null;
  let resolvedAssigneeVideasteId: string | null = input.assigneeVideasteId ?? null;

  if (input.patternId) {
    const pattern = await prisma.accountPattern.findUnique({
      where: { id: input.patternId },
    });
    if (!pattern) {
      throw new ValidationError("Pattern introuvable");
    }
    if (!resolvedAssigneeMonteurId && pattern.defaultAssigneeMonteurId) {
      resolvedAssigneeMonteurId = pattern.defaultAssigneeMonteurId;
    }
    if (!resolvedAssigneeCmId && pattern.defaultAssigneeCmId) {
      resolvedAssigneeCmId = pattern.defaultAssigneeCmId;
    }
    if (!resolvedAssigneeVideasteId && pattern.defaultAssigneeVideasteId) {
      resolvedAssigneeVideasteId = pattern.defaultAssigneeVideasteId;
    }
  }

  // Compte cible
  const account = await prisma.instagramAccount.findUnique({
    where: { id: input.accountId },
  });
  if (!account) {
    throw new NotFoundError("Compte");
  }

  // Date
  const parsedScheduledAt = new Date(input.scheduledAt);
  if (isNaN(parsedScheduledAt.getTime())) {
    throw new ValidationError("scheduledAt invalide");
  }

  // Validation existence des assignees référencés
  if (resolvedAssigneeMonteurId) await ensureUserExists(resolvedAssigneeMonteurId, "assigneeMonteurId");
  if (resolvedAssigneeCmId) await ensureUserExists(resolvedAssigneeCmId, "assigneeCmId");
  if (resolvedAssigneeVideasteId) await ensureUserExists(resolvedAssigneeVideasteId, "assigneeVideasteId");

  const slot = await prisma.publicationSlot.create({
    data: {
      accountId: input.accountId,
      scheduledAt: parsedScheduledAt,
      title: input.title ?? null,
      caption: input.caption ?? null,
      notes: input.notes ?? null,
      templateId: input.templateId ?? null,
      fields: input.fields ? JSON.stringify(input.fields) : "{}",
      fieldSchema: input.fieldSchema ? JSON.stringify(input.fieldSchema) : "[]",
      isAuto: false,
      patternId: input.patternId ?? null,
      assigneeMonteurId: resolvedAssigneeMonteurId,
      assigneeCmId: resolvedAssigneeCmId,
      assigneeVideasteId: resolvedAssigneeVideasteId,
      // Phase 6 — overrides one-off (uniquement si fournis dans le body)
      ...(input.needsCaptionsOverride !== undefined
        ? { needsCaptionsOverride: input.needsCaptionsOverride }
        : {}),
      ...(input.needsDescriptionOverride !== undefined
        ? { needsDescriptionOverride: input.needsDescriptionOverride }
        : {}),
      ...(input.needsRushesOverride !== undefined
        ? { needsRushesOverride: input.needsRushesOverride }
        : {}),
      ...(input.needsBriefOverride !== undefined
        ? { needsBriefOverride: input.needsBriefOverride }
        : {}),
      ...(input.coverModeOverride !== undefined
        ? { coverModeOverride: input.coverModeOverride }
        : {}),
      ...(input.coverPresetIdOverride !== undefined
        ? { coverPresetIdOverride: input.coverPresetIdOverride }
        : {}),
      ...(input.captionPresetIdOverride !== undefined
        ? { captionPresetIdOverride: input.captionPresetIdOverride }
        : {}),
      ...(input.descriptionPromptIdOverride !== undefined
        ? { descriptionPromptIdOverride: input.descriptionPromptIdOverride }
        : {}),
    },
    include: {
      account: { select: { id: true, name: true, handle: true } },
    },
  });

  return {
    ...slot,
    fields: safeJSON<Record<string, string>>(slot.fields, {}),
    fieldSchema: safeJSON<string[]>(slot.fieldSchema, []),
  };
}
