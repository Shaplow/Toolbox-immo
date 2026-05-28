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
  ServiceError,
  ValidationError,
} from "@/lib/services/_runtime/errors";
import {
  ALLOWED_PATCH_FIELDS_BY_ROLE,
  canUserAccessSlot,
  isValidSlotStatus,
} from "@/lib/permissions/slotScope";
import { toUserRole } from "@/lib/permissions/role";
import { logActivity } from "@/lib/services/slot/activity";

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

// ─── patchSlot ────────────────────────────────────────────────────────────────

/**
 * Statuts terminaux réservés aux ADMIN uniquement.
 * MONTEUR/CM/VIDEASTE ne peuvent pas écrire ces valeurs via PATCH même si "status"
 * figure dans leur ALLOWED_PATCH_FIELDS_BY_ROLE. L'escalade vers PUBLISHED se fait
 * exclusivement via POST /api/publications/[id]/mark-published.
 */
const RESERVED_TERMINAL_STATUSES = ["PUBLISHED", "CANCELLED", "ARCHIVED", "REJECTED"] as const;

/** Borne max pour les champs texte libres (DoS storage + XSS différé). */
const MAX_TEXT_FIELD = 5000;

/**
 * Met à jour un PublicationSlot existant.
 *
 * Étapes :
 *  1. Récupération + scoping rôle : 404 si slot inexistant OU non accessible
 *     selon le rôle (anti-énumération, comportement préservé).
 *  2. Filtrage du body via `ALLOWED_PATCH_FIELDS_BY_ROLE[role]` — champs non
 *     autorisés ignorés silencieusement (pas de 403 pour ne pas leaker l'info).
 *  3. Garde statuts terminaux réservés (PUBLISHED/CANCELLED/ARCHIVED/REJECTED).
 *  4. Validations : statut, scheduledAt, bornes texte, shape `fields`, assignees,
 *     cohérence cross-field Phase 5 (toggle ↔ preset).
 *  5. Sanitization : enlève les lignes `PUBLISHED_URL:` du champ notes pour les non-ADMIN.
 *  6. Update Prisma + logs d'activité (STATUS_CHANGED / ASSIGNEE_CHANGED).
 *
 * Throw :
 *  - `NotFoundError("Slot")` si inexistant ou pas accessible.
 *  - `ForbiddenError` si un non-admin essaie d'écrire un statut terminal réservé.
 *  - `ValidationError` sur toute violation de schéma / cohérence.
 *  - `ServiceError("INTERNAL", ..., 500)` si l'update Prisma lance (préserve le
 *    message d'erreur explicite pour le client UI, comportement de l'ancienne route).
 */
export async function patchSlot(
  id: string,
  rawBody: Record<string, unknown>,
  ctx: UserContext,
) {
  const role = toUserRole(ctx.effectiveUser.role);
  const userId = ctx.effectiveUser.id;

  const slot = await prisma.publicationSlot.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      assigneeMonteurId: true,
      assigneeCmId: true,
      assigneeVideasteId: true,
      // Champs nécessaires pour la validation cross-field Phase 5
      needsCaptionsOverride: true,
      needsDescriptionOverride: true,
      captionPresetIdOverride: true,
      descriptionPromptIdOverride: true,
      coverModeOverride: true,
      coverPresetIdOverride: true,
      pattern: {
        select: {
          captionPresetId: true,
          descriptionPromptId: true,
          needsCaptions: true,
          needsDescription: true,
          coverMode: true,
          coverConfig: true,
        },
      },
    },
  });

  if (!slot || !canUserAccessSlot(slot, role, userId)) {
    throw new NotFoundError("Slot");
  }

  // Filtrage rôle : les champs non whitelistés sont ignorés silencieusement.
  const allowedFields = ALLOWED_PATCH_FIELDS_BY_ROLE[role];
  const body = Object.fromEntries(
    Object.entries(rawBody).filter(([key]) => allowedFields.includes(key)),
  );

  const {
    status,
    title,
    caption,
    description,
    templateId,
    scheduledAt,
    fields,
    fieldSchema,
    assigneeMonteurId,
    assigneeCmId,
    assigneeVideasteId,
    patternId,
    currentVersionId,
    isAuto,
    needsClientValidationOverride,
    allowsClientRevisionOverride,
    needsCaptionsOverride,
    needsDescriptionOverride,
    needsRushesOverride,
    needsBriefOverride,
    coverModeOverride,
    coverPresetIdOverride,
    captionPresetIdOverride,
    descriptionPromptIdOverride,
  } = body as Record<string, unknown>;
  // notes mutable car sanitisé avant l'update (H2).
  let { notes } = body as Record<string, unknown>;

  // H1 — Statuts terminaux réservés (PUBLISHED/CANCELLED/ARCHIVED/REJECTED) :
  // l'escalade se fait exclusivement via POST mark-published.
  if (
    typeof status === "string" &&
    (RESERVED_TERMINAL_STATUSES as readonly string[]).includes(status) &&
    role !== "ADMIN"
  ) {
    throw new ForbiddenError(
      "Ce statut est réservé. Utilisez /mark-published ou contactez un admin.",
    );
  }

  if (status !== undefined && !isValidSlotStatus(status)) {
    throw new ValidationError("Statut invalide.");
  }

  if (
    scheduledAt !== undefined &&
    typeof scheduledAt === "string" &&
    isNaN(new Date(scheduledAt).getTime())
  ) {
    throw new ValidationError("scheduledAt invalide");
  }

  // E3 — fix M4 mass-assignment : bornes sur les champs texte.
  for (const [name, value] of [
    ["title", title],
    ["caption", caption],
    ["description", description],
    ["notes", notes],
  ] as const) {
    if (typeof value === "string" && value.length > MAX_TEXT_FIELD) {
      throw new ValidationError(`Le champ ${name} dépasse ${MAX_TEXT_FIELD} caractères`);
    }
  }

  // Validation shape `fields` : Record<string, string> avec keys ≤100 chars
  // et values ≤MAX_TEXT_FIELD chars.
  if (fields !== undefined) {
    if (typeof fields !== "object" || fields === null || Array.isArray(fields)) {
      throw new ValidationError("fields doit être un objet");
    }
    const fieldsObj = fields as Record<string, unknown>;
    for (const [key, value] of Object.entries(fieldsObj)) {
      if (key.length > 100) {
        throw new ValidationError(`Clé fields trop longue (max 100): ${key.slice(0, 20)}…`);
      }
      if (typeof value !== "string" || value.length > MAX_TEXT_FIELD) {
        throw new ValidationError(
          `Valeur fields["${key}"] doit être string ≤${MAX_TEXT_FIELD} chars`,
        );
      }
    }
  }

  // H2 — Sanitization notes pour les non-ADMIN : on supprime toute ligne
  // "PUBLISHED_URL:" pour éviter l'injection de l'ancienne donnée hack.
  if (typeof notes === "string" && role !== "ADMIN") {
    notes = notes
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("PUBLISHED_URL:"))
      .join("\n");
  }

  // M2 — Validation existence + rôle des assignees (déjà filtré côté ADMIN par
  // ALLOWED_PATCH_FIELDS_BY_ROLE — seul ADMIN possède ces champs).
  if (typeof assigneeMonteurId === "string") {
    const monteur = await prisma.user.findUnique({
      where: { id: assigneeMonteurId },
      select: { role: true },
    });
    if (!monteur || !["MONTEUR", "ADMIN"].includes(monteur.role ?? "")) {
      throw new ValidationError("Monteur assignee invalide");
    }
  }
  if (typeof assigneeCmId === "string") {
    const cm = await prisma.user.findUnique({
      where: { id: assigneeCmId },
      select: { role: true },
    });
    if (!cm || !["CM", "ADMIN"].includes(cm.role ?? "")) {
      throw new ValidationError("CM assignee invalide");
    }
  }
  if (typeof assigneeVideasteId === "string") {
    const videaste = await prisma.user.findUnique({
      where: { id: assigneeVideasteId },
      select: { role: true },
    });
    if (!videaste || !["VIDEASTE", "ADMIN"].includes(videaste.role ?? "")) {
      throw new ValidationError("Vidéaste assignee invalide");
    }
  }

  // ── Validation cross-field Phase 5 ─────────────────────────────────────────
  // Simule l'état post-update (slot ∪ body diff) pour vérifier la cohérence
  // toggles ↔ presets. Évite de sauver un slot où la cover auto est activée
  // sans preset (trigger-cover refuserait plus tard cryptiquement).
  const postUpdateNeedsCaptions =
    needsCaptionsOverride !== undefined
      ? (needsCaptionsOverride as boolean | null)
      : slot.needsCaptionsOverride;
  const postUpdateCaptionPresetId =
    captionPresetIdOverride !== undefined
      ? (captionPresetIdOverride as string | null)
      : slot.captionPresetIdOverride;
  const resolvedNeedsCaptions = postUpdateNeedsCaptions ?? slot.pattern?.needsCaptions ?? false;
  const resolvedCaptionPresetId =
    postUpdateCaptionPresetId ?? slot.pattern?.captionPresetId ?? null;
  if (resolvedNeedsCaptions === true && !resolvedCaptionPresetId) {
    throw new ValidationError(
      "Sous-titres auto activés mais aucun preset captions défini (ni au slot, ni au pattern)",
    );
  }

  const postUpdateNeedsDescription =
    needsDescriptionOverride !== undefined
      ? (needsDescriptionOverride as string | null)
      : slot.needsDescriptionOverride;
  const postUpdateDescriptionPromptId =
    descriptionPromptIdOverride !== undefined
      ? (descriptionPromptIdOverride as string | null)
      : slot.descriptionPromptIdOverride;
  const resolvedNeedsDescription =
    postUpdateNeedsDescription ?? slot.pattern?.needsDescription ?? "none";
  const resolvedDescriptionPromptId =
    postUpdateDescriptionPromptId ?? slot.pattern?.descriptionPromptId ?? null;
  if (resolvedNeedsDescription === "autoGenerate" && !resolvedDescriptionPromptId) {
    throw new ValidationError(
      "Description auto activée mais aucun prompt IA défini (ni au slot, ni au pattern)",
    );
  }

  const postUpdateCoverMode =
    coverModeOverride !== undefined
      ? (coverModeOverride as string | null)
      : slot.coverModeOverride;
  const postUpdateCoverPresetId =
    coverPresetIdOverride !== undefined
      ? (coverPresetIdOverride as string | null)
      : slot.coverPresetIdOverride;
  const resolvedCoverMode = postUpdateCoverMode ?? slot.pattern?.coverMode ?? "none";
  const patternCoverPresetIdRaw = slot.pattern?.coverConfig;
  const patternCoverPresetId =
    patternCoverPresetIdRaw &&
    typeof patternCoverPresetIdRaw === "object" &&
    !Array.isArray(patternCoverPresetIdRaw)
      ? (patternCoverPresetIdRaw as { coverPresetId?: string }).coverPresetId ?? null
      : null;
  const resolvedCoverPresetId = postUpdateCoverPresetId ?? patternCoverPresetId;
  if (resolvedCoverMode === "auto" && !resolvedCoverPresetId) {
    throw new ValidationError(
      "Cover mode auto activé mais aucun preset cover défini (ni au slot, ni au pattern)",
    );
  }

  // Update + log activity. On wrap l'update Prisma pour préserver le 500 explicite
  // avec le message d'erreur (comportement de l'ancienne route — utile au client
  // UI qui affiche le détail). mapServiceError ajoutera juste un code "INTERNAL".
  let updated: Awaited<ReturnType<typeof prisma.publicationSlot.update>>;
  try {
    updated = await prisma.publicationSlot.update({
      where: { id },
      data: {
        ...(status !== undefined ? { status: status as string } : {}),
        ...(title !== undefined ? { title: title as string | null } : {}),
        ...(caption !== undefined ? { caption: caption as string | null } : {}),
        ...(description !== undefined ? { description: description as string | null } : {}),
        ...(notes !== undefined ? { notes: notes as string | null } : {}),
        ...(templateId !== undefined ? { templateId: templateId as string | null } : {}),
        ...(scheduledAt !== undefined ? { scheduledAt: new Date(scheduledAt as string) } : {}),
        ...(fields !== undefined ? { fields: JSON.stringify(fields) } : {}),
        ...(fieldSchema !== undefined ? { fieldSchema: JSON.stringify(fieldSchema) } : {}),
        ...(assigneeMonteurId !== undefined
          ? { assigneeMonteurId: assigneeMonteurId as string | null }
          : {}),
        ...(assigneeCmId !== undefined
          ? { assigneeCmId: assigneeCmId as string | null }
          : {}),
        ...(patternId !== undefined ? { patternId: patternId as string | null } : {}),
        ...(currentVersionId !== undefined
          ? { currentVersionId: currentVersionId as string | null }
          : {}),
        ...(isAuto !== undefined ? { isAuto: isAuto as boolean } : {}),
        // W2 + Cohérence Workflows Phase 4 — overrides per-slot.
        // null = hérite du pattern, true/false = écrase. needsDescription est un enum (string).
        ...(needsClientValidationOverride !== undefined
          ? { needsClientValidationOverride: needsClientValidationOverride as boolean | null }
          : {}),
        ...(allowsClientRevisionOverride !== undefined
          ? { allowsClientRevisionOverride: allowsClientRevisionOverride as boolean | null }
          : {}),
        ...(needsCaptionsOverride !== undefined
          ? { needsCaptionsOverride: needsCaptionsOverride as boolean | null }
          : {}),
        ...(needsDescriptionOverride !== undefined
          ? { needsDescriptionOverride: needsDescriptionOverride as string | null }
          : {}),
        ...(needsRushesOverride !== undefined
          ? { needsRushesOverride: needsRushesOverride as boolean | null }
          : {}),
        ...(needsBriefOverride !== undefined
          ? { needsBriefOverride: needsBriefOverride as boolean | null }
          : {}),
        // Phase 5 slots one-off — ressources (preset/prompt) overrides
        ...(coverModeOverride !== undefined
          ? { coverModeOverride: coverModeOverride as string | null }
          : {}),
        ...(coverPresetIdOverride !== undefined
          ? { coverPresetIdOverride: coverPresetIdOverride as string | null }
          : {}),
        ...(captionPresetIdOverride !== undefined
          ? { captionPresetIdOverride: captionPresetIdOverride as string | null }
          : {}),
        ...(descriptionPromptIdOverride !== undefined
          ? { descriptionPromptIdOverride: descriptionPromptIdOverride as string | null }
          : {}),
        ...(assigneeVideasteId !== undefined
          ? { assigneeVideasteId: assigneeVideasteId as string | null }
          : {}),
      },
      include: {
        account: { select: { id: true, name: true, handle: true } },
        template: { select: { id: true, name: true } },
        render: { select: { id: true, status: true, pngUrl: true, videoUrl: true } },
      },
    });
  } catch (err) {
    console.error("[slotService.patchSlot] prisma update failed:", err);
    throw new ServiceError(
      "INTERNAL",
      err instanceof Error ? `Échec de la sauvegarde : ${err.message}` : "Échec de la sauvegarde",
      500,
    );
  }

  // Log d'activité — STATUS_CHANGED si le statut a effectivement changé.
  if (status !== undefined && typeof status === "string" && status !== slot.status) {
    await logActivity(prisma, {
      slotId: id,
      actorId: userId,
      type: "STATUS_CHANGED",
      payload: { from: slot.status, to: status },
    });
  }

  // Log d'activité — ASSIGNEE_CHANGED si l'un des assignees a changé.
  const monteurChanged =
    assigneeMonteurId !== undefined && assigneeMonteurId !== slot.assigneeMonteurId;
  const cmChanged = assigneeCmId !== undefined && assigneeCmId !== slot.assigneeCmId;
  if (monteurChanged || cmChanged) {
    await logActivity(prisma, {
      slotId: id,
      actorId: userId,
      type: "ASSIGNEE_CHANGED",
      payload: {
        ...(monteurChanged
          ? { monteur: { from: slot.assigneeMonteurId, to: assigneeMonteurId ?? null } }
          : {}),
        ...(cmChanged
          ? { cm: { from: slot.assigneeCmId, to: assigneeCmId ?? null } }
          : {}),
      },
    });
  }

  return {
    ...updated,
    fields: safeJSON<Record<string, string>>(updated.fields, {}),
    fieldSchema: safeJSON<string[]>(updated.fieldSchema, []),
  };
}
