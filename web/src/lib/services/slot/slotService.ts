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
import { Prisma } from "@prisma/client";
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
  whereClauseForUser,
} from "@/lib/permissions/slotScope";
import { toUserRole } from "@/lib/permissions/role";
import { logActivity } from "@/lib/services/slot/activity";
import {
  canTransition,
  syncSlotsPipelineStatuses,
} from "@/lib/services/slot/transitions";
import { mapSourceToInitialStatus } from "@/lib/calendarEngine";
import { deleteFromR2 } from "@/lib/r2";
import { safeJSON } from "@/lib/utils/json";

// ─── Types I/O ────────────────────────────────────────────────────────────────

export interface CreateSlotInput {
  accountId: string;
  scheduledAt: string;
  title?: string | null;
  description?: string | null;
  notes?: string | null;
  templateId?: string | null;
  fields?: Record<string, string>;
  fieldSchema?: string[];
  /** Pattern-based creation (Phase 1.6). Si fourni, les assignees sont préfilés depuis le pattern. */
  patternId?: string | null;
  /**
   * P2 — Identifiant d'un PatternBinding (recette appliquée au compte).
   * Source canonique pour identifier la recette. Si fourni, prime sur
   * patternId. Si seul patternId est fourni, on tente le shim de
   * compatibilité au moment de la résolution.
   */
  patternBindingId?: string | null;
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

// safeJSON déplacé dans lib/utils/json.ts pour éviter la duplication avec
// publications/[id]/route.ts (cf. W3.5).

/**
 * Vérifie qu'un user assignee existe ET a le rôle attendu. Partagé par
 * `createSlot` et `patchSlot` pour garantir la même règle des deux côtés
 * (sinon on peut créer un slot avec un CM en `assigneeMonteurId` mais ne pas
 * pouvoir le re-PATCH — asymétrie repérée par le scan-repo 2026-05-28).
 *
 * ADMIN passe toujours (un admin peut endosser n'importe quel rôle d'assignee).
 */
export async function assertAssigneeRole(
  userId: string,
  expectedRoles: readonly string[],
  fieldLabel: string,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (!user || !expectedRoles.includes(user.role ?? "")) {
    throw new ValidationError(`${fieldLabel} : utilisateur invalide ou rôle incorrect`);
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

  // Status initial : si un pattern est fourni, dérive de pattern.source
  // (cohérence avec calendarEngine.generateCalendarSlots). Sinon DRAFT.
  let initialStatus: string = "DRAFT";

  // Titre par défaut = label de la recette quand l'admin n'en saisit pas.
  let patternLabel: string | null = null;

  let resolvedPattern: {
    accountId: string;
    source: string;
    captionPresetId: string | null;
    descriptionPromptId: string | null;
    needsCaptions: boolean;
    needsDescription: string;
    coverMode: string;
    coverConfig: unknown;
    defaultAssigneeMonteurId: string | null;
    defaultAssigneeCmId: string | null;
    defaultAssigneeVideasteId: string | null;
  } | null = null;

  // P2 — Résolution du pattern via PatternBinding (canonique) avec compat
  // legacy : on accepte patternBindingId (préféré) OU patternId (legacy).
  // Si seul patternId est fourni, on tente de résoudre vers le binding
  // équivalent (créé par le backfill migrate-patterns-to-templates).
  let resolvedBindingId: string | null = input.patternBindingId ?? null;
  if (input.patternBindingId) {
    const binding = await prisma.patternBinding.findUnique({
      where: { id: input.patternBindingId },
      include: { patternTemplate: true },
    });
    if (!binding) {
      throw new ValidationError("Pattern introuvable");
    }
    if (binding.accountId !== input.accountId) {
      throw new ValidationError(
        "Le pattern choisi n'appartient pas au compte Instagram de cette publication.",
      );
    }
    const t = binding.patternTemplate;
    patternLabel = t.label;
    resolvedPattern = {
      accountId: binding.accountId,
      source: t.source,
      captionPresetId: binding.captionPresetIdOverride ?? t.captionPresetId,
      descriptionPromptId:
        binding.descriptionPromptIdOverride ?? t.descriptionPromptId,
      needsCaptions: t.needsCaptions,
      needsDescription: t.needsDescription,
      coverMode: binding.coverModeOverride ?? t.coverMode,
      coverConfig: t.coverConfig,
      defaultAssigneeMonteurId: binding.defaultAssigneeMonteurId,
      defaultAssigneeCmId: binding.defaultAssigneeCmId,
      defaultAssigneeVideasteId: binding.defaultAssigneeVideasteId,
    };
    initialStatus = mapSourceToInitialStatus(t.source);
    if (!resolvedAssigneeMonteurId && binding.defaultAssigneeMonteurId) {
      resolvedAssigneeMonteurId = binding.defaultAssigneeMonteurId;
    }
    if (!resolvedAssigneeCmId && binding.defaultAssigneeCmId) {
      resolvedAssigneeCmId = binding.defaultAssigneeCmId;
    }
    if (!resolvedAssigneeVideasteId && binding.defaultAssigneeVideasteId) {
      resolvedAssigneeVideasteId = binding.defaultAssigneeVideasteId;
    }
  } else if (input.patternId) {
    const pattern = await prisma.accountPattern.findUnique({
      where: { id: input.patternId },
    });
    if (!pattern) {
      throw new ValidationError("Pattern introuvable");
    }
    // Cross-account guard : pareil que patchSlot, un pattern d'un autre
    // compte casserait toute la résolution downstream (needs*/cover/
    // idempotence).
    if (pattern.accountId !== input.accountId) {
      throw new ValidationError(
        "Le pattern choisi n'appartient pas au compte Instagram de cette publication.",
      );
    }
    resolvedPattern = pattern;
    patternLabel = pattern.label;
    initialStatus = mapSourceToInitialStatus(pattern.source);
    if (!resolvedAssigneeMonteurId && pattern.defaultAssigneeMonteurId) {
      resolvedAssigneeMonteurId = pattern.defaultAssigneeMonteurId;
    }
    if (!resolvedAssigneeCmId && pattern.defaultAssigneeCmId) {
      resolvedAssigneeCmId = pattern.defaultAssigneeCmId;
    }
    if (!resolvedAssigneeVideasteId && pattern.defaultAssigneeVideasteId) {
      resolvedAssigneeVideasteId = pattern.defaultAssigneeVideasteId;
    }
    // Compat shim : remonte le binding correspondant pour matérialiser
    // slot.patternBindingId même quand l'UI envoie encore patternId.
    // On combine (accountId, publishTime, source, templateId) pour éviter
    // une collision quand le compte a plusieurs recettes au même horaire
    // (cas multi-source rare mais possible).
    const linked = await prisma.patternBinding.findFirst({
      where: {
        accountId: pattern.accountId,
        publishTime: pattern.publishTime,
        patternTemplate: {
          source: pattern.source,
          templateId: pattern.templateId,
        },
      },
      select: { id: true },
    });
    if (linked) {
      resolvedBindingId = linked.id;
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

  // Validation existence + rôle des assignees référencés (parité avec patchSlot).
  if (resolvedAssigneeMonteurId) {
    await assertAssigneeRole(resolvedAssigneeMonteurId, ["MONTEUR", "ADMIN"], "Monteur assignee");
  }
  if (resolvedAssigneeCmId) {
    await assertAssigneeRole(resolvedAssigneeCmId, ["CM", "ADMIN"], "CM assignee");
  }
  if (resolvedAssigneeVideasteId) {
    await assertAssigneeRole(resolvedAssigneeVideasteId, ["VIDEASTE", "ADMIN"], "Vidéaste assignee");
  }

  // Cross-field validation Phase 5 — parité avec patchSlot. Simule l'état
  // post-création (overrides ∪ pattern) pour vérifier la cohérence
  // toggles ↔ presets. Sans ces guards, un admin pouvait créer un slot
  // où needsCaptions=true mais sans aucun captionPresetId résolvable —
  // trigger-captions échouait plus tard de façon cryptique.
  const resolvedNeedsCaptions =
    input.needsCaptionsOverride ?? resolvedPattern?.needsCaptions ?? false;
  const resolvedCaptionPresetId =
    input.captionPresetIdOverride ?? resolvedPattern?.captionPresetId ?? null;
  if (resolvedNeedsCaptions === true && !resolvedCaptionPresetId) {
    throw new ValidationError(
      "Sous-titres auto activés mais aucun preset captions défini (ni au slot, ni au pattern)",
    );
  }
  const resolvedNeedsDescription =
    input.needsDescriptionOverride ?? resolvedPattern?.needsDescription ?? "none";
  const resolvedDescriptionPromptId =
    input.descriptionPromptIdOverride ?? resolvedPattern?.descriptionPromptId ?? null;
  if (resolvedNeedsDescription === "autoGenerate" && !resolvedDescriptionPromptId) {
    throw new ValidationError(
      "Description auto activée mais aucun prompt IA défini (ni au slot, ni au pattern)",
    );
  }
  // Guard cover-mode retiré (fix regression post-QW1) : le runtime
  // (lib/coverAuto.ts:761-767) a un fallback gracieux qui prend le preset
  // par défaut du template (sortOrder min) quand coverConfig n'a ni
  // coverPresetId ni coverPresetName. Bloquer ici empêchait la création
  // de slots valides où le pattern a coverMode="autoPack" sans preset
  // explicite dans coverConfig (le runtime se serait débrouillé). En cas
  // de template sans presets, coverAuto.ts log COVER_CONFIG_ERROR avec
  // un message clair pointant vers le builder — pas besoin de doubler la
  // validation ici.

  const slot = await prisma.publicationSlot.create({
    data: {
      accountId: input.accountId,
      scheduledAt: parsedScheduledAt,
      // Fallback titre = nom de la recette si l'admin ne saisit rien.
      title: (input.title?.trim() || patternLabel) ?? null,
      description: input.description ?? null,
      notes: input.notes ?? null,
      // Status initial dérivé du pattern.source (cohérence calendarEngine
      // — sinon le défaut DB "TO_DO" laisse les slots manuels invisibles
      // dans les worklists qui filtrent par status moderne).
      status: initialStatus,
      templateId: input.templateId ?? null,
      fields: input.fields ? JSON.stringify(input.fields) : "{}",
      fieldSchema: input.fieldSchema ? JSON.stringify(input.fieldSchema) : "[]",
      isAuto: false,
      patternId: input.patternId ?? null,
      patternBindingId: resolvedBindingId,
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

// ─── bulkStockSlots ──────────────────────────────────────────────────────────

/** Bornes quantité pour un batch de slots banque. */
export const BULK_STOCK_MIN = 1;
export const BULK_STOCK_MAX = 20;

export interface BulkStockSlotsInput {
  accountId: string;
  /**
   * P2 — Identifiant du PatternBinding cible (canonique). Accepté aussi
   * un identifiant d'AccountPattern legacy : on résout vers le binding
   * équivalent via le backfill effectué par migrate-patterns-to-templates.
   */
  patternId: string;
  quantity: number;
  /** Override de l'assignation monteur (null = utilise binding.defaultAssigneeMonteurId). */
  monteurId?: string | null;
}

/**
 * Crée N slots "en banque" (scheduledAt: null) pour un pattern `manual_rushes` donné.
 * Ces slots arrivent dans la worklist du monteur sans date programmée et
 * pourront être planifiés depuis la vue Banque du calendar.
 *
 * Contraintes :
 *  - ADMIN uniquement (impersonation insuffisante).
 *  - Le pattern doit être `source = "manual_rushes"` ET appartenir au compte.
 *  - quantity ∈ [BULK_STOCK_MIN, BULK_STOCK_MAX].
 *
 * Status initial : RUSHES_EXPECTED (cohérent avec mapSourceToInitialStatus
 * pour manual_rushes). Le pipeline existant prend ensuite le relais : upload
 * rushs → RUSHES_RECEIVED → version → EDIT_REVIEW etc.
 */
export async function bulkStockSlots(input: BulkStockSlotsInput, ctx: UserContext) {
  if (!ctx.canAdminBypass) {
    throw new ForbiddenError("Réservé aux administrateurs");
  }

  const actorId = ctx.actualUser.id;

  if (!input.accountId || !input.patternId) {
    throw new ValidationError("accountId et patternId sont requis");
  }

  const quantity = Math.floor(input.quantity);
  if (!Number.isFinite(quantity) || quantity < BULK_STOCK_MIN || quantity > BULK_STOCK_MAX) {
    throw new ValidationError(
      `quantity doit être entre ${BULK_STOCK_MIN} et ${BULK_STOCK_MAX}`,
    );
  }

  // P2 — Résolution du binding : on tente d'abord PatternBinding (canonique),
  // sinon on tombe sur l'AccountPattern legacy (compat shim pendant la
  // transition UI). Tous les bindings ont été créés à partir d'AccountPatterns
  // via le script de migration, donc le résolveur les retrouve par jointure.
  const binding = await prisma.patternBinding.findUnique({
    where: { id: input.patternId },
    include: { patternTemplate: true },
  });

  let resolvedBinding = binding;
  if (!resolvedBinding) {
    // Compat shim : input.patternId pointe peut-être encore sur l'ancien
    // AccountPattern. On cherche le binding correspondant via
    // (accountId, publishTime, source, templateId) pour discriminer les
    // cas où plusieurs recettes coexistent au même horaire.
    const legacy = await prisma.accountPattern.findUnique({
      where: { id: input.patternId },
      select: {
        id: true,
        accountId: true,
        publishTime: true,
        source: true,
        templateId: true,
      },
    });
    if (legacy) {
      resolvedBinding = await prisma.patternBinding.findFirst({
        where: {
          accountId: legacy.accountId,
          publishTime: legacy.publishTime,
          patternTemplate: {
            source: legacy.source,
            templateId: legacy.templateId,
          },
        },
        include: { patternTemplate: true },
      });
    }
  }
  if (!resolvedBinding) {
    throw new ValidationError("Pattern introuvable");
  }
  if (resolvedBinding.accountId !== input.accountId) {
    throw new ValidationError(
      "Le pattern choisi n'appartient pas au compte Instagram cible.",
    );
  }
  if (resolvedBinding.patternTemplate.source !== "manual_rushes") {
    throw new ValidationError(
      "La banque n'accepte que les patterns de type « Montage rushes » (manual_rushes).",
    );
  }

  // Snapshot des champs résolus utilisés par le reste de la fonction.
  const pattern = {
    id: resolvedBinding.id,
    accountId: resolvedBinding.accountId,
    source: resolvedBinding.patternTemplate.source,
    templateId:
      resolvedBinding.templateIdOverride ?? resolvedBinding.patternTemplate.templateId,
    defaultAssigneeMonteurId: resolvedBinding.defaultAssigneeMonteurId,
    defaultAssigneeCmId: resolvedBinding.defaultAssigneeCmId,
    defaultAssigneeVideasteId: resolvedBinding.defaultAssigneeVideasteId,
  };

  // Compte cible
  const account = await prisma.instagramAccount.findUnique({
    where: { id: input.accountId },
    select: { id: true },
  });
  if (!account) {
    throw new NotFoundError("Compte");
  }

  // Résolution monteur : override prime sur le défaut du pattern.
  const resolvedMonteurId =
    input.monteurId !== undefined && input.monteurId !== null
      ? input.monteurId
      : pattern.defaultAssigneeMonteurId;
  if (resolvedMonteurId) {
    await assertAssigneeRole(resolvedMonteurId, ["MONTEUR", "ADMIN"], "Monteur assignee");
  }

  const initialStatus = mapSourceToInitialStatus(pattern.source);

  // Atomicité : createMany + logActivity dans une seule transaction.
  // Comme createMany ne retourne pas les ids créés, on utilise create() en
  // boucle dans la tx — quantité bornée à 20 donc impact négligeable.
  const created = await prisma.$transaction(async (tx) => {
    const ids: string[] = [];
    for (let i = 0; i < quantity; i += 1) {
      const slot = await tx.publicationSlot.create({
        data: {
          accountId: input.accountId,
          scheduledAt: null,
          status: initialStatus,
          templateId: pattern.templateId ?? null,
          patternBindingId: pattern.id,
          assigneeMonteurId: resolvedMonteurId ?? null,
          assigneeCmId: pattern.defaultAssigneeCmId ?? null,
          assigneeVideasteId: pattern.defaultAssigneeVideasteId ?? null,
          isAuto: false,
          fields: "{}",
          fieldSchema: "[]",
        },
        select: { id: true },
      });
      ids.push(slot.id);
      await logActivity(tx as typeof prisma, {
        slotId: slot.id,
        actorId,
        type: "BANK_SLOT_CREATED",
        payload: { patternBindingId: pattern.id, batchSize: quantity, index: i },
      });
    }
    return ids;
  });

  return { createdIds: created, count: created.length };
}

// ─── bulkPatchSlots ──────────────────────────────────────────────────────────

export const BULK_PATCH_MIN = 1;
export const BULK_PATCH_MAX = 50;

export interface BulkPatchSlotsInput {
  /** IDs des slots à patcher. */
  slotIds: string[];
  /**
   * Patch commun à appliquer à tous les slots.
   * Seuls les champs `assigneeMonteurId`, `assigneeCmId`, `assigneeVideasteId`,
   * `scheduledAt` (ISO), `status` sont supportés.
   * Les valeurs absentes sont ignorées (pas de patch). Pour reset un champ
   * d'assignation, passer null explicitement.
   */
  patch: {
    assigneeMonteurId?: string | null;
    assigneeCmId?: string | null;
    assigneeVideasteId?: string | null;
    scheduledAt?: string | null;
    status?: string;
  };
}

/**
 * Sprint C — Applique un patch commun à N slots calendrier.
 *
 * Contraintes :
 *  - ADMIN uniquement (les autres rôles n'ont pas de cas d'usage bulk
 *    légitime — un monteur ne patch que ses propres slots un par un).
 *  - Vérification existence + scope des assignees référencés.
 *  - Vérification cross-account pour scheduledAt non concernée (la date est
 *    propre au slot).
 *  - Activity log par slot pour STATUS_CHANGED / ASSIGNEE_CHANGED.
 *  - Reuse de canTransition pour valider chaque changement de statut.
 */
export async function bulkPatchSlots(
  input: BulkPatchSlotsInput,
  ctx: UserContext,
): Promise<{ patchedCount: number; skippedCount: number }> {
  if (!ctx.canAdminBypass) {
    throw new ForbiddenError("Réservé aux administrateurs");
  }

  const actorId = ctx.actualUser.id;

  if (!Array.isArray(input.slotIds) || input.slotIds.length === 0) {
    throw new ValidationError("slotIds requis (au moins 1)");
  }
  if (
    input.slotIds.length < BULK_PATCH_MIN ||
    input.slotIds.length > BULK_PATCH_MAX
  ) {
    throw new ValidationError(
      `Entre ${BULK_PATCH_MIN} et ${BULK_PATCH_MAX} slots par opération`,
    );
  }
  const { patch } = input;
  const hasAnyPatch =
    patch.assigneeMonteurId !== undefined ||
    patch.assigneeCmId !== undefined ||
    patch.assigneeVideasteId !== undefined ||
    patch.scheduledAt !== undefined ||
    patch.status !== undefined;
  if (!hasAnyPatch) {
    throw new ValidationError("Aucun champ à patcher");
  }

  if (patch.status !== undefined && !isValidSlotStatus(patch.status)) {
    throw new ValidationError("Statut invalide");
  }
  if (
    patch.scheduledAt !== undefined &&
    patch.scheduledAt !== null &&
    isNaN(new Date(patch.scheduledAt).getTime())
  ) {
    throw new ValidationError("scheduledAt invalide");
  }

  // Validation existence + rôle des assignees référencés.
  if (typeof patch.assigneeMonteurId === "string") {
    await assertAssigneeRole(
      patch.assigneeMonteurId,
      ["MONTEUR", "ADMIN"],
      "Monteur assignee",
    );
  }
  if (typeof patch.assigneeCmId === "string") {
    await assertAssigneeRole(
      patch.assigneeCmId,
      ["CM", "ADMIN"],
      "CM assignee",
    );
  }
  if (typeof patch.assigneeVideasteId === "string") {
    await assertAssigneeRole(
      patch.assigneeVideasteId,
      ["VIDEASTE", "ADMIN"],
      "Vidéaste assignee",
    );
  }

  // Charge l'état actuel des slots pour valider transitions + logguer.
  const slots = await prisma.publicationSlot.findMany({
    where: { id: { in: input.slotIds } },
    select: {
      id: true,
      status: true,
      assigneeMonteurId: true,
      assigneeCmId: true,
      assigneeVideasteId: true,
    },
  });
  // Bug C.1 — IDs demandés mais absents en DB (supprimés ou jamais existé).
  // On les compte explicitement dans `skipped` pour ne pas mentir à l'admin :
  // "10 demandés, 7 patchés, 0 skippés" alors que 3 étaient introuvables.
  const missingCount = input.slotIds.length - slots.length;

  const data: Record<string, unknown> = {};
  if (patch.assigneeMonteurId !== undefined)
    data.assigneeMonteurId = patch.assigneeMonteurId;
  if (patch.assigneeCmId !== undefined) data.assigneeCmId = patch.assigneeCmId;
  if (patch.assigneeVideasteId !== undefined)
    data.assigneeVideasteId = patch.assigneeVideasteId;
  if (patch.scheduledAt !== undefined)
    data.scheduledAt =
      patch.scheduledAt === null ? null : new Date(patch.scheduledAt);
  if (patch.status !== undefined) data.status = patch.status;

  let patched = 0;
  let skipped = missingCount;

  // Transaction : update + activity log par slot.
  await prisma.$transaction(async (tx) => {
    for (const slot of slots) {
      // Si patch.status, vérifie la transition (ADMIN bypass dans canTransition).
      if (patch.status && patch.status !== slot.status) {
        if (!canTransition(slot.status, patch.status, "ADMIN")) {
          skipped += 1;
          continue;
        }
      }
      await tx.publicationSlot.update({
        where: { id: slot.id },
        data,
      });

      // Logs activity
      if (patch.status !== undefined && patch.status !== slot.status) {
        await logActivity(tx as typeof prisma, {
          slotId: slot.id,
          actorId,
          type: "STATUS_CHANGED",
          payload: { from: slot.status, to: patch.status, batch: true },
        });
      }
      const monteurChanged =
        patch.assigneeMonteurId !== undefined &&
        patch.assigneeMonteurId !== slot.assigneeMonteurId;
      const cmChanged =
        patch.assigneeCmId !== undefined &&
        patch.assigneeCmId !== slot.assigneeCmId;
      const videasteChanged =
        patch.assigneeVideasteId !== undefined &&
        patch.assigneeVideasteId !== slot.assigneeVideasteId;
      if (monteurChanged || cmChanged || videasteChanged) {
        await logActivity(tx as typeof prisma, {
          slotId: slot.id,
          actorId,
          type: "ASSIGNEE_CHANGED",
          payload: {
            ...(monteurChanged
              ? {
                  monteur: {
                    from: slot.assigneeMonteurId,
                    to: patch.assigneeMonteurId ?? null,
                  },
                }
              : {}),
            ...(cmChanged
              ? {
                  cm: { from: slot.assigneeCmId, to: patch.assigneeCmId ?? null },
                }
              : {}),
            ...(videasteChanged
              ? {
                  videaste: {
                    from: slot.assigneeVideasteId,
                    to: patch.assigneeVideasteId ?? null,
                  },
                }
              : {}),
            batch: true,
          },
        });
      }
      patched += 1;
    }
  });

  return { patchedCount: patched, skippedCount: skipped };
}

// ─── bulkScheduleSlots ───────────────────────────────────────────────────────

/** Bornes quantité d'un batch de programmation banque → calendrier. */
export const BULK_SCHEDULE_MIN = 1;
export const BULK_SCHEDULE_MAX = 50;

export interface BulkScheduleSlotsInput {
  /** IDs des slots banque (scheduledAt: null) à programmer. */
  slotIds: string[];
  /**
   * Date+heure ISO 8601 complète de départ (avec timezone offset ou suffixe Z).
   * Le client (BulkScheduleModal) convertit l'heure locale du navigateur en
   * ISO UTC pour éviter toute ambiguïté de fuseau côté serveur.
   */
  startDateTimeISO: string;
  /**
   * Si fourni, étale les slots sur N jours consécutifs depuis startDate
   * (jour i = startDate + i jours). Si non fourni, tous les slots reçoivent
   * la même date.
   */
  spreadOverDays?: number;
  /**
   * Si true, lit `binding.publishTime` pour chaque slot au lieu de garder
   * l'heure de `startDateTimeISO`. L'heure du binding est appliquée en UTC
   * (publishTime "10:00" → 10:00Z), cohérent avec le reste des heures naïves
   * du repo (cf. createSlot qui accepte également des ISO UTC).
   */
  useBindingTime?: boolean;
}

const PUBLISH_TIME_RE = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;

/**
 * Sprint B — Programme N slots banque vers le calendrier en une opération.
 *
 * Contraintes :
 *  - ADMIN uniquement.
 *  - Tous les slots doivent être en banque (scheduledAt: null) au moment de
 *    l'appel ; les slots déjà programmés sont skippés silencieusement.
 *  - startDateTimeISO doit être une ISO 8601 complète parsable.
 *  - spreadOverDays ∈ [1, slotIds.length] ou undefined.
 *
 * Émet un événement BANK_SLOT_SCHEDULED par slot dans l'activity log.
 */
export async function bulkScheduleSlots(
  input: BulkScheduleSlotsInput,
  ctx: UserContext,
): Promise<{ scheduledCount: number; skippedCount: number }> {
  if (!ctx.canAdminBypass) {
    throw new ForbiddenError("Réservé aux administrateurs");
  }

  const actorId = ctx.actualUser.id;

  if (!Array.isArray(input.slotIds) || input.slotIds.length === 0) {
    throw new ValidationError("slotIds requis (au moins 1)");
  }
  if (
    input.slotIds.length < BULK_SCHEDULE_MIN ||
    input.slotIds.length > BULK_SCHEDULE_MAX
  ) {
    throw new ValidationError(
      `Entre ${BULK_SCHEDULE_MIN} et ${BULK_SCHEDULE_MAX} slots par opération`,
    );
  }
  const baseStart = new Date(input.startDateTimeISO);
  if (isNaN(baseStart.getTime())) {
    throw new ValidationError("startDateTimeISO invalide");
  }
  if (input.spreadOverDays !== undefined) {
    if (
      !Number.isInteger(input.spreadOverDays) ||
      input.spreadOverDays < 1 ||
      input.spreadOverDays > input.slotIds.length
    ) {
      throw new ValidationError(
        `spreadOverDays doit être entre 1 et ${input.slotIds.length}`,
      );
    }
  }

  // Charge les slots cibles + le binding pour récupérer publishTime si besoin.
  const slots = await prisma.publicationSlot.findMany({
    where: { id: { in: input.slotIds } },
    select: {
      id: true,
      scheduledAt: true,
      patternBinding: {
        select: { publishTime: true },
      },
    },
  });

  const targets = slots.filter((s) => s.scheduledAt === null);
  const skipped = slots.length - targets.length;
  if (targets.length === 0) {
    return { scheduledCount: 0, skippedCount: skipped };
  }

  // Calcule la date+heure de chaque slot. Tout en UTC pour rester
  // déterministe côté serveur (peut tourner en UTC ou non).
  const oneDayMs = 24 * 60 * 60 * 1000;

  function computeScheduledAt(index: number, bindingPublishTime?: string): Date {
    const dayOffset =
      input.spreadOverDays !== undefined
        ? index % input.spreadOverDays
        : 0;
    const day = new Date(baseStart.getTime() + dayOffset * oneDayMs);
    if (input.useBindingTime && bindingPublishTime && PUBLISH_TIME_RE.test(bindingPublishTime)) {
      const [h, m] = bindingPublishTime.split(":").map(Number);
      day.setUTCHours(h, m, 0, 0);
    }
    return day;
  }

  // Atomique : updates + activity logs dans une transaction.
  const scheduled = await prisma.$transaction(async (tx) => {
    let count = 0;
    for (let i = 0; i < targets.length; i += 1) {
      const slot = targets[i];
      const scheduledAt = computeScheduledAt(i, slot.patternBinding?.publishTime);
      await tx.publicationSlot.update({
        where: { id: slot.id },
        data: { scheduledAt },
      });
      await logActivity(tx as typeof prisma, {
        slotId: slot.id,
        actorId,
        type: "BANK_SLOT_SCHEDULED",
        payload: { scheduledAt: scheduledAt.toISOString(), batch: true },
      });
      count += 1;
    }
    return count;
  });

  return { scheduledCount: scheduled, skippedCount: skipped };
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
  // Fix bug audit 2026-05-30 (H2) : pendant impersonation, effectiveUser =
  // user impersonné, actualUser = admin réel. Les logs activity doivent
  // tracer l'admin réel (audit trail), pas l'user impersonné.
  // Cf. CLAUDE.md Phase 1.8 § "Décision par usage".
  const actorId = ctx.actualUser.id;

  const slot = await prisma.publicationSlot.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      // Banque : on a besoin du scheduledAt actuel pour détecter la transition
      // null → date (promotion depuis la banque vers le calendrier).
      scheduledAt: true,
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
      // P2 — Lire les deux modèles : pattern (AccountPattern legacy) pour les
      // slots historiques, patternBinding (canonique) pour les nouveaux slots.
      // La résolution effective merge template + binding overrides côté code.
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
      patternBinding: {
        select: {
          captionPresetIdOverride: true,
          descriptionPromptIdOverride: true,
          coverModeOverride: true,
          patternTemplate: {
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
    needsAdminValidationOverride,
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

  // Garde anti-bypass : un ADMIN peut techniquement PATCH status="PUBLISHED"
  // depuis le SlotDetailPanel (matrice STATUS_TRANSITIONS l'autorise), mais
  // cela court-circuiterait /mark-published qui pose publishedUrl +
  // publishedAt + activity PUBLISHED. Sans ces champs, le slot apparaît
  // "publié" sans URL et la worklist CM ne se met pas à jour cohéremment.
  // Forcer le passage par /mark-published, même pour les ADMIN.
  if (status === "PUBLISHED") {
    throw new ForbiddenError(
      "Pour marquer un slot comme publié, utilisez l'action « Marquer publié » dans la fiche publication. " +
        "Cela enregistre aussi l'URL Instagram et la date de publication.",
    );
  }

  // Enforcement de la matrice STATUS_TRANSITIONS au niveau API.
  // Avant ce check : MONTEUR/CM pouvaient envoyer PATCH avec n'importe
  // quel statut hors RESERVED_TERMINAL_STATUSES, même sauter des étapes
  // (DRAFT → SCHEDULED, EDIT_REVIEW → READY_FOR_CM sans validation CM, etc.).
  // canTransition est déjà appliqué dans le select du SlotDetailPanel pour
  // afficher la liste, mais la matrice n'était pas enforced côté serveur.
  // ADMIN bypass total est dans canTransition lui-même.
  if (
    typeof status === "string" &&
    status !== slot.status &&
    !canTransition(slot.status, status, role)
  ) {
    throw new ForbiddenError(
      `Transition de statut interdite pour votre rôle : ${slot.status} → ${status}`,
    );
  }

  // scheduledAt accepte string (date programmée), null (remise en banque)
  // ou undefined (pas de changement). Toute autre valeur → erreur.
  if (
    scheduledAt !== undefined &&
    scheduledAt !== null &&
    typeof scheduledAt === "string" &&
    isNaN(new Date(scheduledAt).getTime())
  ) {
    throw new ValidationError("scheduledAt invalide");
  }
  if (
    scheduledAt !== undefined &&
    scheduledAt !== null &&
    typeof scheduledAt !== "string"
  ) {
    throw new ValidationError("scheduledAt doit être une chaîne ISO ou null");
  }
  // Defense-in-depth : remettre un slot en banque (scheduledAt: null) reste
  // une action d'orchestration admin, même si un futur changement de
  // ALLOWED_PATCH_FIELDS_BY_ROLE ouvrait ce champ à un autre rôle.
  if (scheduledAt === null && !ctx.canAdminBypass) {
    throw new ForbiddenError(
      "Seul un administrateur peut renvoyer un slot vers la banque.",
    );
  }

  // E3 — fix M4 mass-assignment : bornes sur les champs texte.
  for (const [name, value] of [
    ["title", title],
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
    await assertAssigneeRole(assigneeMonteurId, ["MONTEUR", "ADMIN"], "Monteur assignee");
  }
  if (typeof assigneeCmId === "string") {
    await assertAssigneeRole(assigneeCmId, ["CM", "ADMIN"], "CM assignee");
  }
  if (typeof assigneeVideasteId === "string") {
    await assertAssigneeRole(assigneeVideasteId, ["VIDEASTE", "ADMIN"], "Vidéaste assignee");
  }

  // Si patternId change, on doit :
  //   1. Vérifier que le nouveau pattern appartient au MÊME compte que le slot
  //      (cross-account leak : un pattern de compte B pour un slot de compte A
  //      casse toute la résolution needs*/cover/assignees aval).
  //   2. Charger ses needs* pour que la validation cross-field ci-dessous
  //      utilise le NOUVEAU pattern, pas l'ancien. Sans ce refetch,
  //      changer le pattern + activer needsCaptionsOverride en un seul PATCH
  //      valide la cohérence contre l'ancien pattern → la nouvelle config
  //      peut être incohérente sans alerte.
  // P2 — résolution du pattern effectif :
  //   - en lecture du slot : slot.pattern (legacy) en priorité, sinon
  //     slot.patternBinding (template + overrides binding) ;
  //   - sur changement (patternId fourni dans le body) : on tente d'abord
  //     PatternBinding (canonique de la nouvelle UI), puis AccountPattern
  //     (legacy) en compat shim. Le payload de patchSlot continue à utiliser
  //     `patternId` comme nom de clé pour ne pas multiplier les champs API.
  let effectivePattern: {
    captionPresetId: string | null;
    descriptionPromptId: string | null;
    needsCaptions: boolean;
    needsDescription: string;
    coverMode: string;
    coverConfig: unknown;
  } | null = slot.pattern;
  if (!effectivePattern && slot.patternBinding) {
    const b = slot.patternBinding;
    const t = b.patternTemplate;
    effectivePattern = {
      captionPresetId: b.captionPresetIdOverride ?? t.captionPresetId,
      descriptionPromptId: b.descriptionPromptIdOverride ?? t.descriptionPromptId,
      needsCaptions: t.needsCaptions,
      needsDescription: t.needsDescription,
      coverMode: b.coverModeOverride ?? t.coverMode,
      coverConfig: t.coverConfig,
    };
  }
  if (typeof patternId === "string" && patternId !== "") {
    // 1) Essai PatternBinding (canonique).
    const binding = await prisma.patternBinding.findUnique({
      where: { id: patternId },
      include: { patternTemplate: true },
    });
    if (binding) {
      // Cross-account guard.
      const slotAccount = await prisma.publicationSlot.findUnique({
        where: { id },
        select: { accountId: true },
      });
      if (slotAccount && binding.accountId !== slotAccount.accountId) {
        throw new ValidationError(
          "Le pattern choisi n'appartient pas au compte Instagram de cette publication.",
        );
      }
      const t = binding.patternTemplate;
      effectivePattern = {
        captionPresetId: binding.captionPresetIdOverride ?? t.captionPresetId,
        descriptionPromptId: binding.descriptionPromptIdOverride ?? t.descriptionPromptId,
        needsCaptions: t.needsCaptions,
        needsDescription: t.needsDescription,
        coverMode: binding.coverModeOverride ?? t.coverMode,
        coverConfig: t.coverConfig,
      };
    } else {
      // 2) Fallback AccountPattern legacy.
      const newPattern = await prisma.accountPattern.findUnique({
        where: { id: patternId },
        select: {
          accountId: true,
          captionPresetId: true,
          descriptionPromptId: true,
          needsCaptions: true,
          needsDescription: true,
          coverMode: true,
          coverConfig: true,
        },
      });
      if (!newPattern) {
        throw new ValidationError("Pattern introuvable");
      }
      const slotAccount = await prisma.publicationSlot.findUnique({
        where: { id },
        select: { accountId: true },
      });
      if (slotAccount && newPattern.accountId !== slotAccount.accountId) {
        throw new ValidationError(
          "Le pattern choisi n'appartient pas au compte Instagram de cette publication.",
        );
      }
      effectivePattern = {
        captionPresetId: newPattern.captionPresetId,
        descriptionPromptId: newPattern.descriptionPromptId,
        needsCaptions: newPattern.needsCaptions,
        needsDescription: newPattern.needsDescription,
        coverMode: newPattern.coverMode,
        coverConfig: newPattern.coverConfig,
      };
    }
  }
  // patternId="" / null : reset l'effective pattern à null pour la validation.
  if (patternId === null || patternId === "") {
    effectivePattern = null;
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
  const resolvedNeedsCaptions = postUpdateNeedsCaptions ?? effectivePattern?.needsCaptions ?? false;
  const resolvedCaptionPresetId =
    postUpdateCaptionPresetId ?? effectivePattern?.captionPresetId ?? null;
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
    postUpdateNeedsDescription ?? effectivePattern?.needsDescription ?? "none";
  const resolvedDescriptionPromptId =
    postUpdateDescriptionPromptId ?? effectivePattern?.descriptionPromptId ?? null;
  if (resolvedNeedsDescription === "autoGenerate" && !resolvedDescriptionPromptId) {
    throw new ValidationError(
      "Description auto activée mais aucun prompt IA défini (ni au slot, ni au pattern)",
    );
  }

  // Guard cover-mode retiré (idem createSlot ci-dessus) : le runtime
  // coverAuto.ts a un fallback gracieux preset par défaut du template
  // (sortOrder min). Pas besoin de bloquer le PATCH si le pattern a
  // coverMode="autoPack" sans coverPresetId dans coverConfig — le moteur
  // se débrouille au moment du render et log COVER_CONFIG_ERROR si
  // vraiment rien n'est résolvable.

  // Update + logActivity (STATUS_CHANGED, ASSIGNEE_CHANGED) dans une seule
  // transaction. Sans ça, un crash entre l'update et l'un des logActivity
  // laissait le slot modifié avec un audit-trail partiel (gap silencieux,
  // finding slot-11). cancelPendingJobsForSlot reste hors-tx car best-effort
  // (cascade peut échouer sans devoir rollback la transition).
  const statusChanged =
    status !== undefined && typeof status === "string" && status !== slot.status;
  const monteurChanged =
    assigneeMonteurId !== undefined && assigneeMonteurId !== slot.assigneeMonteurId;
  const cmChanged = assigneeCmId !== undefined && assigneeCmId !== slot.assigneeCmId;
  const videasteChanged =
    assigneeVideasteId !== undefined && assigneeVideasteId !== slot.assigneeVideasteId;
  const anyAssigneeChanged = monteurChanged || cmChanged || videasteChanged;
  // Transition banque → planifié : le slot était stocké (scheduledAt: null)
  // et reçoit une date programmée. Émet un événement BANK_SLOT_SCHEDULED en
  // plus du log scheduledAt normal pour matérialiser la promotion.
  const bankScheduled =
    slot.scheduledAt === null &&
    scheduledAt !== undefined &&
    scheduledAt !== null &&
    typeof scheduledAt === "string";

  let updated: Awaited<ReturnType<typeof prisma.publicationSlot.update>>;
  try {
    updated = await prisma.$transaction(async (tx) => {
      // W5.14 : construction iterative de la data — chaque field passe par
      // un transformer typé. Avant : 60 LOC de spreads conditionnels où
      // ajouter un nouveau patchable demandait 3 éditions (ALLOWED_PATCH_
      // FIELDS_BY_ROLE + destructure + spread). Maintenant : 1 entrée dans
      // FIELD_TRANSFORMERS suffit.
      const FIELD_TRANSFORMERS: Record<string, (v: unknown) => unknown> = {
        status: (v) => v as string,
        title: (v) => v as string | null,
        description: (v) => v as string | null,
        notes: (v) => v as string | null,
        templateId: (v) => v as string | null,
        // null = remise en banque ; string ISO = (re)planification.
        scheduledAt: (v) => (v === null ? null : new Date(v as string)),
        fields: (v) => JSON.stringify(v),
        fieldSchema: (v) => JSON.stringify(v),
        assigneeMonteurId: (v) => v as string | null,
        assigneeCmId: (v) => v as string | null,
        assigneeVideasteId: (v) => v as string | null,
        patternId: (v) => v as string | null,
        currentVersionId: (v) => v as string | null,
        isAuto: (v) => v as boolean,
        // Phase 5/6 — overrides per-slot (null = hérite, true/false = écrase)
        needsAdminValidationOverride: (v) => v as boolean | null,
        needsClientValidationOverride: (v) => v as boolean | null,
        allowsClientRevisionOverride: (v) => v as boolean | null,
        needsCaptionsOverride: (v) => v as boolean | null,
        needsDescriptionOverride: (v) => v as string | null, // enum string
        needsRushesOverride: (v) => v as boolean | null,
        needsBriefOverride: (v) => v as boolean | null,
        coverModeOverride: (v) => v as string | null,
        coverPresetIdOverride: (v) => v as string | null,
        captionPresetIdOverride: (v) => v as string | null,
        descriptionPromptIdOverride: (v) => v as string | null,
      };

      const FIELD_VALUES: Record<string, unknown> = {
        status, title, description, notes, templateId, scheduledAt,
        fields, fieldSchema,
        assigneeMonteurId, assigneeCmId, assigneeVideasteId,
        patternId, currentVersionId, isAuto,
        needsAdminValidationOverride, needsClientValidationOverride,
        allowsClientRevisionOverride, needsCaptionsOverride,
        needsDescriptionOverride, needsRushesOverride, needsBriefOverride,
        coverModeOverride, coverPresetIdOverride,
        captionPresetIdOverride, descriptionPromptIdOverride,
      };

      const updateData: Record<string, unknown> = {};
      for (const [field, transformer] of Object.entries(FIELD_TRANSFORMERS)) {
        const raw = FIELD_VALUES[field];
        if (raw !== undefined) updateData[field] = transformer(raw);
      }

      const u = await tx.publicationSlot.update({
        where: { id },
        data: updateData as Prisma.PublicationSlotUpdateInput,
        include: {
          account: { select: { id: true, name: true, handle: true } },
          template: { select: { id: true, name: true } },
          render: { select: { id: true, status: true, pngUrl: true, videoUrl: true } },
        },
      });

      if (statusChanged) {
        await logActivity(tx as typeof prisma, {
          slotId: id,
          actorId,
          type: "STATUS_CHANGED",
          payload: { from: slot.status, to: status as string },
        });
      }

      if (anyAssigneeChanged) {
        await logActivity(tx as typeof prisma, {
          slotId: id,
          actorId,
          type: "ASSIGNEE_CHANGED",
          payload: {
            ...(monteurChanged
              ? { monteur: { from: slot.assigneeMonteurId, to: assigneeMonteurId ?? null } }
              : {}),
            ...(cmChanged
              ? { cm: { from: slot.assigneeCmId, to: assigneeCmId ?? null } }
              : {}),
            ...(videasteChanged
              ? { videaste: { from: slot.assigneeVideasteId, to: assigneeVideasteId ?? null } }
              : {}),
          },
        });
      }

      if (bankScheduled) {
        await logActivity(tx as typeof prisma, {
          slotId: id,
          actorId,
          type: "BANK_SLOT_SCHEDULED",
          payload: { scheduledAt: scheduledAt as string },
        });
      }

      return u;
    });
  } catch (err) {
    console.error("[slotService.patchSlot] prisma update failed:", err);
    throw new ServiceError(
      "INTERNAL",
      err instanceof Error ? `Échec de la sauvegarde : ${err.message}` : "Échec de la sauvegarde",
      500,
    );
  }

  // Cancel cascade : si on passe à CANCELLED, marquer les jobs en cours comme
  // FAILED (Render, CaptionJob, DescriptionJob). Best-effort hors-tx : un
  // échec ici ne doit pas rollback la transition (le slot EST cancelled, on
  // signale l'échec dans les logs mais on confirme l'update).
  if (statusChanged && status === "CANCELLED") {
    try {
      await cancelPendingJobsForSlot(id);
    } catch (err) {
      console.error(
        `[patchSlot] cancel cascade failed for slot=${id}:`,
        err,
      );
    }
  }

  return {
    ...updated,
    fields: safeJSON<Record<string, string>>(updated.fields, {}),
    fieldSchema: safeJSON<string[]>(updated.fieldSchema, []),
  };
}

// ─── listSlots ────────────────────────────────────────────────────────────────

export interface ListSlotsFilters {
  accountId?: string;
  status?: string;
  patternId?: string;
  monteurId?: string;
  cmId?: string;
  videasteId?: string;
  dateFrom?: string;
  dateTo?: string;
  /**
   * Filtre banque :
   * - "only"    : ne retourne QUE les slots stockés (scheduledAt: null).
   * - undefined : mix (défaut). Les date-range filtres excluent déjà les nulls
   *   naturellement (Prisma `gte/lte` ne match pas null).
   */
  bank?: "only";
}

/**
 * Liste les PublicationSlot accessibles à l'utilisateur, avec filtres optionnels.
 *
 * - Scope rôle injecté en premier dans AND (les filtres URL ne peuvent jamais
 *   l'écraser : protection contre un filtre `id=X` qui viendrait spread sur
 *   le clause USER `id:"__never__"`).
 * - `monteurId` / `cmId` sont des raffinements UX pour l'ADMIN ; pour un
 *   MONTEUR/CM, l'intersection AND maintient le scope sécurisé.
 * - Limite hard à 500 ; `hasMore` indique au client qu'il a atteint la borne.
 * - Rattrapage opportuniste : `syncSlotsPipelineStatuses` met à jour les slots
 *   dont le render PROCESSING/DONE doit faire transitionner vers IN_PROGRESS/READY_FOR_CM
 *   (best-effort, non bloquant). Le statut renvoyé reflète immédiatement la transition.
 *
 * Throw :
 *  - `ForbiddenError` si l'appelant est `EXTERNAL_GENERATOR` (pas d'accès pipeline).
 */
export async function listSlots(filters: ListSlotsFilters, ctx: UserContext) {
  const role = toUserRole(ctx.effectiveUser.role);
  const userId = ctx.effectiveUser.id;

  if (role === "EXTERNAL_GENERATOR") {
    throw new ForbiddenError("Accès refusé");
  }

  const roleScope = whereClauseForUser(role, userId);

  const bankClause: Prisma.PublicationSlotWhereInput =
    filters.bank === "only" ? { scheduledAt: null } : {};

  // Pour la vue Banque (bank="only"), trier par dernière maj (updatedAt desc) —
  // les slots les plus récemment touchés (upload récent, validation) en premier.
  // Sinon, conserve le tri scheduledAt asc (grille semaine, worklists).
  const orderBy: Prisma.PublicationSlotOrderByWithRelationInput =
    filters.bank === "only"
      ? { updatedAt: "desc" }
      : { scheduledAt: "asc" };

  const slots = await prisma.publicationSlot.findMany({
    where: {
      AND: [
        roleScope,
        bankClause,
        filters.accountId ? { accountId: filters.accountId } : {},
        filters.status ? { status: filters.status } : {},
        filters.patternId ? { patternId: filters.patternId } : {},
        filters.monteurId ? { assigneeMonteurId: filters.monteurId } : {},
        filters.cmId ? { assigneeCmId: filters.cmId } : {},
        filters.videasteId ? { assigneeVideasteId: filters.videasteId } : {},
        filters.dateFrom || filters.dateTo
          ? {
              scheduledAt: {
                ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
                ...(filters.dateTo ? { lte: new Date(filters.dateTo) } : {}),
              },
            }
          : {},
      ],
    },
    orderBy,
    take: 500,
    include: {
      account: { select: { id: true, name: true, handle: true } },
      template: { select: { id: true, name: true } },
      // render + coverFramePack du render (cas auto_template). Pour les patterns
      // manual_rushes, le coverFramePack est rattaché à currentVersion ; on le
      // fetch séparément ci-dessous.
      render: {
        select: {
          id: true,
          status: true,
          pngUrl: true,
          videoUrl: true,
          coverFramePack: { select: { status: true } },
        },
      },
      // CoverFramePack côté manual_rushes / external_upload (Phase 5).
      currentVersion: {
        select: {
          id: true,
          coverFramePack: { select: { status: true } },
        },
      },
      assigneeMonteur: { select: { id: true, name: true } },
      assigneeCm: { select: { id: true, name: true } },
      assigneeVideaste: { select: { id: true, name: true } },
      // pattern.source + needsCaptions nécessaires pour syncSlotsPipelineStatuses.
      // needs* + allows* pour l'affichage des valeurs héritées dans les
      // OverrideSelect du SlotDetailPanel (Cohérence Workflows Phase 4).
      pattern: {
        select: {
          label: true,
          source: true,
          needsCaptions: true,
          needsCaptionsMode: true,
          needsAdminValidation: true,
          needsClientValidation: true,
          allowsClientRevision: true,
          needsDescription: true,
          needsRushes: true,
          needsBrief: true,
          // Phase 5 — coverMode pour OverrideEnumSelect dans SlotDetailPanel
          coverMode: true,
        },
      },
      // Dernier job captions/description pour alimenter PipelineDots avec
      // les vraies données (au lieu de déduire depuis slot.status).
      // take:5 + staleSince exposé : syncSlotsPipelineStatuses applique
      // un guard `!c.staleSince` qui sinon évalue !undefined === true et
      // traite chaque job stale comme frais (bug post-promote).
      captionJobs: {
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { status: true, staleSince: true },
      },
      descriptionJobs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true, result: true },
      },
    },
  });

  const updates = await syncSlotsPipelineStatuses(
    prisma,
    slots.map((s) => ({
      id: s.id,
      status: s.status,
      pattern: s.pattern
        ? {
            source: s.pattern.source,
            needsCaptions: s.pattern.needsCaptions,
            needsCaptionsMode: s.pattern.needsCaptionsMode,
          }
        : null,
      render: s.render ? { status: s.render.status } : null,
      captionJobs: s.captionJobs.map((c) => ({ status: c.status, staleSince: c.staleSince })),
    })),
  );

  return {
    slots: slots.map((s) => ({
      ...s,
      status: updates.get(s.id) ?? s.status,
      fields: safeJSON<Record<string, string>>(s.fields, {}),
      fieldSchema: safeJSON<string[]>(s.fieldSchema, []),
    })),
    hasMore: slots.length === 500,
  };
}

// ─── getSlot ──────────────────────────────────────────────────────────────────

/**
 * Charge un PublicationSlot par id, scopé par rôle.
 *
 * 404 systématique si le slot n'existe pas OU n'est pas accessible selon le
 * rôle — on ne distingue pas les deux cas (anti-énumération).
 */
export async function getSlot(id: string, ctx: UserContext) {
  const role = toUserRole(ctx.effectiveUser.role);
  const userId = ctx.effectiveUser.id;

  const slot = await prisma.publicationSlot.findUnique({
    where: { id },
    include: {
      account: { select: { id: true, name: true, handle: true } },
      template: { select: { id: true, name: true } },
      render: { select: { id: true, status: true, pngUrl: true, videoUrl: true } },
      assigneeMonteur: { select: { id: true, name: true } },
      assigneeCm: { select: { id: true, name: true } },
      assigneeVideaste: { select: { id: true, name: true } },
    },
  });

  if (!slot || !canUserAccessSlot(slot, role, userId)) {
    throw new NotFoundError("Slot");
  }

  return {
    ...slot,
    fields: safeJSON<Record<string, string>>(slot.fields, {}),
    fieldSchema: safeJSON<string[]>(slot.fieldSchema, []),
  };
}

// ─── cancelPendingJobsForSlot ────────────────────────────────────────────────

/**
 * Marque tous les jobs RunPod en cours (Render PENDING/PROCESSING,
 * CaptionJob QUEUED/PROCESSING) comme FAILED quand un slot est annulé.
 *
 * Pas d'appel à l'API RunPod pour annuler côté pod — coûteux et fragile.
 * On se contente du marquage DB qui suffit pour :
 *  - Sortir les jobs des worklists "en cours"
 *  - Ignorer les webhooks RunPod qui arriveraient APRÈS (le webhook checke
 *    typiquement que le status n'est pas déjà terminal avant de l'écraser)
 *  - Permettre au sweep périodique d'identifier les orphelins
 *
 * Best-effort : chaque update est wrappé en try/catch — un échec sur Render
 * ne bloque pas le cancel CaptionJob, etc.
 */
async function cancelPendingJobsForSlot(slotId: string): Promise<void> {
  const cancelMsg = "Slot annulé — job interrompu";

  // Render (publicationSlotId est unique sur Render)
  try {
    const updated = await prisma.render.updateMany({
      where: {
        publicationSlotId: slotId,
        status: { in: ["PENDING", "PROCESSING"] },
      },
      data: { status: "ERROR", errorMsg: cancelMsg },
    });
    if (updated.count > 0) {
      console.info(
        `[cancelPendingJobsForSlot] slot=${slotId} marked ${updated.count} render(s) as ERROR`,
      );
    }
  } catch (err) {
    console.error(`[cancelPendingJobsForSlot] render update failed slot=${slotId}:`, err);
  }

  // CaptionJob
  try {
    const updated = await prisma.captionJob.updateMany({
      where: {
        slotId,
        status: { in: ["QUEUED", "PROCESSING"] },
      },
      data: { status: "FAILED", errorMsg: cancelMsg },
    });
    if (updated.count > 0) {
      console.info(
        `[cancelPendingJobsForSlot] slot=${slotId} marked ${updated.count} caption job(s) as FAILED`,
      );
    }
  } catch (err) {
    console.error(`[cancelPendingJobsForSlot] captionJob update failed slot=${slotId}:`, err);
  }

  // DescriptionJob — sans ce block, un slot annulé pouvait recevoir un
  // webhook DESCRIPTION_COMPLETED qui écrasait la description manuelle ou
  // déclenchait des transitions silencieuses.
  try {
    const updated = await prisma.descriptionJob.updateMany({
      where: {
        slotId,
        status: { in: ["QUEUED", "PROCESSING"] },
      },
      data: { status: "FAILED", errorMsg: cancelMsg },
    });
    if (updated.count > 0) {
      console.info(
        `[cancelPendingJobsForSlot] slot=${slotId} marked ${updated.count} description job(s) as FAILED`,
      );
    }
  } catch (err) {
    console.error(`[cancelPendingJobsForSlot] descriptionJob update failed slot=${slotId}:`, err);
  }
}

// ─── deleteSlot ───────────────────────────────────────────────────────────────

/**
 * Supprime un PublicationSlot (ADMIN uniquement).
 *
 * Renvoie 404 (pas 403) pour les non-ADMIN, par cohérence avec GET/PATCH :
 * un non-admin ne doit pas savoir si le slot existe.
 *
 * Cleanup R2 : avant Prisma cascade (qui supprime les rows PublicationVersion,
 * PublicationRush, PublicationBriefAttachment en DB), on récupère les R2 keys
 * pour les supprimer du bucket. Sans ce cleanup, chaque slot supprimé
 * laissait derrière lui ses fichiers vidéo/image dans R2 — fuite de
 * stockage permanente.
 *
 * Best-effort : on log les échecs R2 mais on continue la suppression DB.
 * Un échec partiel R2 vaut mieux que de laisser le slot indéfiniment.
 *
 * Render et CaptionJob ont `onDelete: SetNull` côté FK donc le lien slot
 * devient null mais les jobs restent en DB avec leurs propres R2 keys.
 * Ils ne sont PAS nettoyés ici — c'est de la dette assumée car ces jobs
 * peuvent être ré-utilisés (re-render sur un autre slot, etc.).
 */
export async function deleteSlot(id: string, ctx: UserContext) {
  const role = toUserRole(ctx.effectiveUser.role);

  if (role !== "ADMIN") {
    throw new NotFoundError("Slot");
  }

  // Charge le slot + tous les enfants qui détiennent des R2 keys avant
  // que Prisma cascade ne les supprime de la DB. La lecture et le delete
  // doivent vivre dans la même transaction — sans ça, un upload-complete
  // concurrent peut insérer un PublicationRush ou une PublicationVersion
  // entre la lecture et le delete. La cascade les supprime mais leurs
  // r2Key n'ont pas été collectés → fuite R2 silencieuse.
  const r2KeysToDelete: string[] = await prisma.$transaction(async (tx) => {
    const slot = await tx.publicationSlot.findUnique({
      where: { id },
      include: {
        versions: { select: { r2Key: true } },
        rushes: { select: { r2Key: true } },
        brief: { include: { attachments: { select: { r2Key: true } } } },
      },
    });
    if (!slot) {
      throw new NotFoundError("Slot");
    }

    const keys: string[] = [
      ...slot.versions.map((v) => v.r2Key),
      ...slot.rushes.map((r) => r.r2Key),
      ...(slot.brief?.attachments.map((a) => a.r2Key) ?? []),
    ];

    // Delete dans la même tx : cascade supprime les rows enfants.
    await tx.publicationSlot.delete({ where: { id } });

    return keys;
  });

  // Cleanup R2 — best-effort. On itère séquentiellement pour ne pas
  // saturer le bucket en cas de slot avec beaucoup de versions/rushes.
  // Chaque échec est loggué avec le key pour permettre un cleanup
  // manuel (script ou réessai opérationnel).
  for (const key of r2KeysToDelete) {
    try {
      await deleteFromR2(key);
    } catch (err) {
      console.error(
        `[deleteSlot] R2 cleanup failed for slotId=${id} key=${key}:`,
        err,
      );
    }
  }

  return { ok: true, r2KeysDeleted: r2KeysToDelete.length };
}
