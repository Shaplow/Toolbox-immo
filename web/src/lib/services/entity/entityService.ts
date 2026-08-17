/**
 * Service Entity — création, lecture, modification, suppression et gestion des
 * slots (missions/reels) rattachés à une fiche (métaobjet).
 *
 * Plan simplification Phase 5 : port de `event/eventService.ts` (ShootEvent)
 * généralisé aux DEUX visibilités (`admin` ex-Property « Bien », `team`
 * ex-ShootEvent « Tournage »). Convention identique au slotService/eventService :
 * throw `ServiceError`, la route mappe vers HTTP via `mapServiceError`. Scoping
 * via `entityScope.ts`.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { UserContext } from "@/lib/userContext";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/services/_runtime/errors";
import { toUserRole } from "@/lib/permissions/role";
import {
  ALLOWED_ENTITY_PATCH_FIELDS_BY_ROLE,
  canAttachSlotToEntity,
  canCreateEntity,
  canUserAccessEntity,
  whereClauseForUserEntity,
} from "@/lib/permissions/entityScope";
import { logEntityActivity } from "@/lib/services/entity/entityActivity";
import { assertAssigneeRole, createSlot, type CreateSlotInput } from "@/lib/services/slot/slotService";
import { hasTool, TOOLS } from "@/lib/permissions";
import { deleteR2Prefix } from "@/lib/r2";
import { safeJSON } from "@/lib/utils/json";
import { normalizeCustomFields } from "@/lib/customFields";

// ─── Types I/O ────────────────────────────────────────────────────────────────

export interface CreateEntityInput {
  typeId: string;
  label: string;
  fields?: Record<string, string>;
  accountId?: string | null;
  scheduledAt?: string | null;
  endAt?: string | null;
  assigneeVideasteId?: string | null;
  defaultAssigneeMonteurId?: string | null;
  defaultAssigneeCmId?: string | null;
  notes?: string | null;
  brief?: string | null;
  /** Fiche liée (ex ShootEvent.propertyId), self-relation Entity → Entity. */
  relatedEntityId?: string | null;
}

export interface ListEntitiesFilters {
  typeId?: string | null;
  includeArchived?: boolean;
}

export interface UpdateEntityInput {
  [key: string]: unknown;
}

/**
 * Input d'attache d'un slot à une fiche — fusionne deux chemins distincts :
 *  - « missions » (fiche admin, ex-Bien) : N recettes lancées d'un coup.
 *  - « reel » (fiche team, ex-Tournage) : un seul reel attaché, avec les
 *    gardes/overrides d'`attachReelToEvent`.
 */
export interface AttachSlotToEntityInput {
  // Chemin missions.
  recipeIds?: string[];
  accountId?: string | null;
  // Chemin reel.
  patternBindingId?: string | null;
  patternTemplateId?: string | null;
  scheduledAt?: string | null;
  title?: string | null;
  description?: string | null;
  propertyId?: string | null;
  assigneeMonteurId?: string | null;
  assigneeCmId?: string | null;
  assigneeVideasteId?: string | null;
}

export type AttachSlotToEntityResult =
  | { mode: "missions"; createdIds: string[]; count: number }
  | { mode: "reel"; slot: Awaited<ReturnType<typeof createSlot>> };

const ENTITY_STATUSES = ["PLANNED", "SHOT", "DONE", "CANCELLED"] as const;

/**
 * Sources de recette compatibles avec un reel de fiche : montage manuel des
 * rushs partagés. `auto_template` est exclu — il déclencherait un step « Rendu
 * vidéo » fantôme (aucun Render) et un CTA de rendu qui écraserait le montage.
 */
const REEL_ATTACHABLE_SOURCES = ["manual_rushes", "external_upload"] as const;

const MAX_LABEL = 200;
const MAX_KEY = 100;
const MAX_VALUE = 5000;

// ─── Helpers de validation ──────────────────────────────────────────────────

function parseDateOrThrow(value: string, label: string): Date {
  const d = new Date(value);
  if (isNaN(d.getTime())) throw new ValidationError(`${label} invalide`);
  return d;
}

/** Valide un objet `fields` libre : clés ≤100, valeurs string ≤5000. */
function validateFields(fields: unknown): string | null {
  if (fields === undefined) return null;
  if (typeof fields !== "object" || fields === null || Array.isArray(fields)) {
    return "fields doit être un objet";
  }
  const obj = fields as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (key.length > MAX_KEY) return `Clé fields trop longue (max ${MAX_KEY}): ${key.slice(0, 20)}…`;
    if (typeof value !== "string" || value.length > MAX_VALUE) {
      return `Valeur fields["${key}"] doit être string ≤${MAX_VALUE} chars`;
    }
  }
  return null;
}

async function assertAccountExists(accountId: string): Promise<void> {
  const account = await prisma.instagramAccount.findUnique({
    where: { id: accountId },
    select: { id: true },
  });
  if (!account) throw new NotFoundError("Compte");
}

async function assertRelatedEntityUsable(entityId: string): Promise<void> {
  const related = await prisma.entity.findUnique({
    where: { id: entityId },
    select: { id: true, isArchived: true },
  });
  if (!related) throw new NotFoundError("Fiche liée");
  if (related.isArchived) throw new ValidationError("La fiche liée est archivée");
}

// ─── Sérialisation ──────────────────────────────────────────────────────────

/**
 * Parse les colonnes JSON string (`fields`, `type.fieldSchema`) vers leur forme
 * exploitable. Appliqué à chaque lecture (pas de migration DB — cohérent avec
 * `normalizeCustomFields`/`safeJSON` utilisés partout ailleurs dans le repo).
 */
type WithParsedFields<T extends { fields: string; type: { fieldSchema: string } & Record<string, unknown> }> = Omit<
  T,
  "fields" | "type"
> & {
  fields: Record<string, string>;
  type: Omit<T["type"], "fieldSchema"> & { fieldSchema: ReturnType<typeof normalizeCustomFields> };
};

function withParsedFields<
  T extends { fields: string; type: { fieldSchema: string } & Record<string, unknown> },
>(entity: T): WithParsedFields<T> {
  return {
    ...entity,
    fields: safeJSON<Record<string, string>>(entity.fields, {}),
    type: { ...entity.type, fieldSchema: normalizeCustomFields(entity.type.fieldSchema) },
  } as WithParsedFields<T>;
}

// ─── Includes partagés ──────────────────────────────────────────────────────

const entityListSelect = {
  id: true,
  typeId: true,
  type: {
    select: {
      id: true,
      name: true,
      namePlural: true,
      icon: true,
      visibility: true,
      hasPlanning: true,
      hasAccount: true,
      hasRushes: true,
      hasAssignees: true,
      fieldSchema: true,
    },
  },
  label: true,
  fields: true,
  isArchived: true,
  accountId: true,
  account: { select: { id: true, name: true, handle: true } },
  scheduledAt: true,
  endAt: true,
  shotAt: true,
  status: true,
  assigneeVideasteId: true,
  assigneeVideaste: { select: { id: true, name: true } },
  defaultAssigneeMonteurId: true,
  defaultAssigneeCmId: true,
  notes: true,
  relatedEntityId: true,
  related: { select: { id: true, label: true, typeId: true } },
  createdAt: true,
  updatedAt: true,
  _count: { select: { slots: true, shootSlots: true, rushes: { where: { deletedAt: null } } } },
} satisfies Prisma.EntitySelect;

const entityDetailSelect = {
  id: true,
  typeId: true,
  type: true,
  label: true,
  fields: true,
  isArchived: true,
  accountId: true,
  account: { select: { id: true, name: true, handle: true } },
  scheduledAt: true,
  endAt: true,
  shotAt: true,
  status: true,
  assigneeVideasteId: true,
  assigneeVideaste: { select: { id: true, name: true } },
  defaultAssigneeMonteurId: true,
  defaultAssigneeMonteur: { select: { id: true, name: true } },
  defaultAssigneeCmId: true,
  defaultAssigneeCm: { select: { id: true, name: true } },
  notes: true,
  brief: true,
  relatedEntityId: true,
  related: { select: { id: true, label: true, typeId: true } },
  relatedOf: { select: { id: true, label: true, typeId: true } },
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
  // Reels/missions dont cette fiche est la source de données (ex-propertyId).
  slots: {
    select: {
      id: true,
      title: true,
      status: true,
      scheduledAt: true,
      assigneeMonteurId: true,
      assigneeCmId: true,
      assigneeVideasteId: true,
      patternBindingId: true,
    },
    orderBy: { createdAt: "asc" },
  },
  // Reels rattachés à cette fiche comme tournage (ex-eventId) — aussi la source
  // de vérité pour `canUserAccessEntity` (assignés via reel).
  shootSlots: {
    select: {
      id: true,
      title: true,
      status: true,
      scheduledAt: true,
      assigneeMonteurId: true,
      assigneeCmId: true,
      assigneeVideasteId: true,
      patternBindingId: true,
    },
    orderBy: { createdAt: "asc" },
  },
  rushes: {
    where: { deletedAt: null },
    orderBy: { uploadedAt: "desc" },
    select: {
      id: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      durationSec: true,
      uploadedAt: true,
      uploadedBy: { select: { id: true, name: true } },
    },
  },
  activities: {
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      type: true,
      payload: true,
      createdAt: true,
      actor: { select: { id: true, name: true } },
    },
  },
  _count: { select: { slots: true, shootSlots: true, rushes: { where: { deletedAt: null } } } },
} satisfies Prisma.EntitySelect;

// ─── createEntity ─────────────────────────────────────────────────────────────

/**
 * Crée une fiche (Entity). Réservé aux ADMIN réels (canAdminBypass).
 * Seed optionnel des défauts monteur/CM depuis le binding actif du compte
 * (uniquement si un compte est fourni).
 */
export async function createEntity(input: CreateEntityInput, ctx: UserContext) {
  const role = toUserRole(ctx.effectiveUser.role);
  if (!ctx.canAdminBypass || !canCreateEntity(role)) {
    throw new ForbiddenError("Réservé aux administrateurs");
  }

  if (!input.typeId) throw new ValidationError("Un type de fiche est requis");
  const type = await prisma.entityType.findUnique({ where: { id: input.typeId } });
  if (!type) throw new NotFoundError("Type de fiche");

  const label = input.label?.trim();
  if (!label) throw new ValidationError("Un libellé est requis");
  if (label.length > MAX_LABEL) throw new ValidationError(`Libellé trop long (max ${MAX_LABEL} caractères)`);

  const fieldsErr = validateFields(input.fields);
  if (fieldsErr) throw new ValidationError(fieldsErr);

  let scheduledAt: Date | null = null;
  let endAt: Date | null = null;
  let status: string | null = null;
  if (type.hasPlanning) {
    if (!input.scheduledAt) throw new ValidationError("Une date est requise pour ce type de fiche");
    scheduledAt = parseDateOrThrow(input.scheduledAt, "Date");
    if (input.endAt) {
      endAt = parseDateOrThrow(input.endAt, "Date de fin");
      if (endAt < scheduledAt) throw new ValidationError("La fin ne peut pas précéder le début");
    }
    status = "PLANNED";
  }

  if (type.hasAccount && !input.accountId) {
    throw new ValidationError("Un compte Instagram est requis pour ce type de fiche");
  }
  if (input.accountId) await assertAccountExists(input.accountId);

  if (input.relatedEntityId) await assertRelatedEntityUsable(input.relatedEntityId);

  if (input.assigneeVideasteId) {
    await assertAssigneeRole(input.assigneeVideasteId, ["VIDEASTE", "ADMIN"], "Vidéaste");
  }
  if (input.defaultAssigneeMonteurId) {
    await assertAssigneeRole(input.defaultAssigneeMonteurId, ["MONTEUR", "ADMIN"], "Monteur par défaut");
  }
  if (input.defaultAssigneeCmId) {
    await assertAssigneeRole(input.defaultAssigneeCmId, ["CM", "ADMIN"], "CM par défaut");
  }

  // Seed des défauts monteur/CM depuis le binding actif du compte (si non fournis).
  let seededMonteurId = input.defaultAssigneeMonteurId ?? null;
  let seededCmId = input.defaultAssigneeCmId ?? null;
  if (input.accountId && (!seededMonteurId || !seededCmId)) {
    const binding = await prisma.patternBinding.findFirst({
      where: { accountId: input.accountId, isActive: true },
      orderBy: { createdAt: "asc" },
      select: { defaultAssigneeMonteurId: true, defaultAssigneeCmId: true },
    });
    if (binding) {
      seededMonteurId ??= binding.defaultAssigneeMonteurId;
      seededCmId ??= binding.defaultAssigneeCmId;
    }
  }

  const entity = await prisma.$transaction(async (tx) => {
    const created = await tx.entity.create({
      data: {
        typeId: input.typeId,
        label,
        fields: input.fields !== undefined ? JSON.stringify(input.fields) : "{}",
        accountId: input.accountId ?? null,
        scheduledAt,
        endAt,
        status,
        assigneeVideasteId: input.assigneeVideasteId ?? null,
        defaultAssigneeMonteurId: seededMonteurId,
        defaultAssigneeCmId: seededCmId,
        notes: input.notes ?? null,
        brief: input.brief ?? null,
        relatedEntityId: input.relatedEntityId ?? null,
        createdByUserId: ctx.actualUser.id,
      },
      select: entityListSelect,
    });
    await logEntityActivity(tx, {
      entityId: created.id,
      actorId: ctx.actualUser.id,
      type: "CREATED",
      payload: { typeId: input.typeId },
    });
    return created;
  });

  return withParsedFields(entity);
}

// ─── listEntities ─────────────────────────────────────────────────────────────

export async function listEntities(filters: ListEntitiesFilters, ctx: UserContext) {
  const role = toUserRole(ctx.effectiveUser.role);
  const scope = whereClauseForUserEntity(role, ctx.effectiveUser.id);

  let orderBy: Prisma.EntityOrderByWithRelationInput = { label: "asc" };
  if (filters.typeId) {
    const type = await prisma.entityType.findUnique({
      where: { id: filters.typeId },
      select: { hasPlanning: true },
    });
    if (type?.hasPlanning) orderBy = { scheduledAt: "asc" };
  }

  const entities = await prisma.entity.findMany({
    where: {
      ...scope,
      ...(filters.typeId ? { typeId: filters.typeId } : {}),
      ...(filters.includeArchived ? {} : { isArchived: false }),
    },
    orderBy,
    take: 500,
    select: entityListSelect,
  });

  return entities.map(withParsedFields);
}

// ─── getEntity ────────────────────────────────────────────────────────────────

export async function getEntity(id: string, ctx: UserContext) {
  const role = toUserRole(ctx.effectiveUser.role);

  const entity = await prisma.entity.findUnique({
    where: { id },
    select: entityDetailSelect,
  });

  // 404 anti-énumération : introuvable OU hors scope → même réponse.
  if (!entity || !canUserAccessEntity(entity, role, ctx.effectiveUser.id)) {
    throw new NotFoundError("Fiche");
  }

  return withParsedFields(entity);
}

// ─── patchEntity ────────────────────────────────────────────────────────────

const entityPatchAccessSelect = {
  id: true,
  typeId: true,
  type: { select: { visibility: true, hasPlanning: true } },
  status: true,
  scheduledAt: true,
  endAt: true,
  assigneeVideasteId: true,
  defaultAssigneeMonteurId: true,
  defaultAssigneeCmId: true,
  shootSlots: { select: { assigneeMonteurId: true, assigneeCmId: true } },
} satisfies Prisma.EntitySelect;

export async function patchEntity(id: string, patch: UpdateEntityInput, ctx: UserContext) {
  const role = toUserRole(ctx.effectiveUser.role);

  const existing = await prisma.entity.findUnique({
    where: { id },
    select: entityPatchAccessSelect,
  });
  if (!existing || !canUserAccessEntity(existing, role, ctx.effectiveUser.id)) {
    throw new NotFoundError("Fiche");
  }

  // Filtrer le patch par la liste blanche du rôle.
  const allowed = ALLOWED_ENTITY_PATCH_FIELDS_BY_ROLE[role] ?? [];
  const data: Prisma.EntityUpdateInput & Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    if (allowed.includes(key)) data[key] = patch[key];
  }

  // Passage manuel à SHOT : on NE l'écrit pas via l'update générique — il doit
  // passer par markEntityShot (pose shotAt + bump des reels PLANNED→IN_EDIT),
  // sinon la fiche serait SHOT avec shotAt=null et des reels bloqués.
  const wantsShot =
    typeof data.status === "string" && data.status === "SHOT" && existing.status !== "SHOT";
  if (wantsShot) delete data.status;

  if (Object.keys(data).length === 0 && !wantsShot) {
    throw new ValidationError("Aucun champ modifiable pour votre rôle");
  }

  // Validations ciblées.
  if (typeof data.label === "string") {
    const trimmed = data.label.trim();
    if (!trimmed) throw new ValidationError("Le libellé ne peut pas être vide");
    if (trimmed.length > MAX_LABEL) throw new ValidationError(`Libellé trop long (max ${MAX_LABEL} caractères)`);
    data.label = trimmed;
  }
  if (data.fields !== undefined) {
    const err = validateFields(data.fields);
    if (err) throw new ValidationError(err);
    data.fields = JSON.stringify(data.fields);
  }
  if (typeof data.status === "string" && !ENTITY_STATUSES.includes(data.status as never)) {
    throw new ValidationError("Statut de fiche invalide");
  }
  if (data.scheduledAt) data.scheduledAt = parseDateOrThrow(String(data.scheduledAt), "Date");
  if (data.endAt) data.endAt = parseDateOrThrow(String(data.endAt), "Date de fin");
  // Cohérence date : la fin ne peut précéder le début (combine patch + existant).
  const effScheduledAt = (data.scheduledAt as Date | undefined) ?? existing.scheduledAt;
  const effEndAt = (data.endAt as Date | undefined) ?? existing.endAt;
  if (effScheduledAt && effEndAt && effEndAt < effScheduledAt) {
    throw new ValidationError("La fin ne peut pas précéder le début");
  }
  if (typeof data.relatedEntityId === "string" && data.relatedEntityId) {
    await assertRelatedEntityUsable(data.relatedEntityId);
  }
  if (typeof data.accountId === "string" && data.accountId) {
    await assertAccountExists(data.accountId);
  }
  if (typeof data.assigneeVideasteId === "string") {
    await assertAssigneeRole(data.assigneeVideasteId, ["VIDEASTE", "ADMIN"], "Vidéaste");
  }
  if (typeof data.defaultAssigneeMonteurId === "string") {
    await assertAssigneeRole(data.defaultAssigneeMonteurId, ["MONTEUR", "ADMIN"], "Monteur par défaut");
  }
  if (typeof data.defaultAssigneeCmId === "string") {
    await assertAssigneeRole(data.defaultAssigneeCmId, ["CM", "ADMIN"], "CM par défaut");
  }

  const statusChanged = typeof data.status === "string" && data.status !== existing.status;

  const updated = await prisma.$transaction(async (tx) => {
    let result: Prisma.EntityGetPayload<{ select: typeof entityListSelect }> | null = null;
    const hasGenericFields = Object.keys(data).length > 0;
    if (hasGenericFields) {
      result = await tx.entity.update({ where: { id }, data, select: entityListSelect });
      await logEntityActivity(tx, {
        entityId: id,
        actorId: ctx.actualUser.id,
        type: statusChanged ? "STATUS_CHANGED" : "UPDATED",
        payload: statusChanged ? { from: existing.status, to: data.status } : { fields: Object.keys(data) },
      });
    }
    if (wantsShot) {
      // Pose SHOT + shotAt + bump reels + log SHOT, atomiquement.
      await markEntityShot(tx, id, ctx.actualUser.id);
    }
    if (!result) {
      result = await tx.entity.findUnique({ where: { id }, select: entityListSelect });
    }
    return result;
  });

  if (!updated) throw new NotFoundError("Fiche");
  return withParsedFields(updated);
}

// ─── deleteEntity ────────────────────────────────────────────────────────────

/**
 * Supprime une fiche. Admin only. Refuse (409) si des slots y sont rattachés
 * (source de données OU tournage) — l'admin doit d'abord les détacher. Sinon
 * hard-delete (cascade activités/rushes) + nettoyage best-effort du préfixe R2.
 */
export async function deleteEntity(id: string, ctx: UserContext) {
  if (!ctx.canAdminBypass) throw new ForbiddenError("Réservé aux administrateurs");

  const existing = await prisma.entity.findUnique({
    where: { id },
    select: { id: true, _count: { select: { slots: true, shootSlots: true } } },
  });
  if (!existing) throw new NotFoundError("Fiche");

  const attachedCount = existing._count.slots + existing._count.shootSlots;
  if (attachedCount > 0) {
    throw new ConflictError(
      "Cette fiche est référencée par des publications : détachez-les avant de supprimer.",
    );
  }

  await prisma.entity.delete({ where: { id } });
  // Nettoyage best-effort des objets R2 résiduels (rushs) sous ce préfixe.
  try {
    await deleteR2Prefix(`entities/${id}/`);
  } catch (err) {
    console.warn(`[deleteEntity] cleanup R2 échoué pour entities/${id}/ :`, err);
  }
  return { deleted: true };
}

// ─── attachSlotToEntity ───────────────────────────────────────────────────────

const entityAttachSelect = {
  id: true,
  isArchived: true,
  type: { select: { visibility: true, hasPlanning: true, hasRushes: true } },
  accountId: true,
  status: true,
  assigneeVideasteId: true,
  defaultAssigneeMonteurId: true,
  defaultAssigneeCmId: true,
  shootSlots: { select: { assigneeMonteurId: true, assigneeCmId: true } },
} satisfies Prisma.EntitySelect;

type EntityAttachRow = Prisma.EntityGetPayload<{ select: typeof entityAttachSelect }>;

/**
 * Attache un slot à une fiche. Deux chemins distincts selon les capacités du
 * type :
 *  - `!(hasPlanning && hasRushes)` (fiche admin, ex-Bien) → chemin « missions » :
 *    porte `properties/[id]/missions` (N recettes → N PublicationSlot via
 *    `propertyId: entityId`). Gating par outil (`hasTool(TOOLS.MISSION)` ou
 *    admin réel) — PAS `canAttachSlotToEntity`, les fiches admin ne sont
 *    scopées par rôle pour personne d'autre que l'ADMIN.
 *  - `hasPlanning && hasRushes` (fiche team, ex-Tournage) → chemin « reel » :
 *    port direct d'`attachReelToEvent` (createSlot avec `eventId: entityId` +
 *    gardes source de recette).
 */
export async function attachSlotToEntity(
  entityId: string,
  input: AttachSlotToEntityInput,
  ctx: UserContext,
): Promise<AttachSlotToEntityResult> {
  const entity = await prisma.entity.findUnique({ where: { id: entityId }, select: entityAttachSelect });
  if (!entity) throw new NotFoundError("Fiche");

  const isTeamFiche = entity.type.hasPlanning && entity.type.hasRushes;
  if (!isTeamFiche) {
    return attachMissionsToEntity(entityId, input, ctx);
  }
  return attachReelToEntity(entityId, entity, input, ctx);
}

async function attachMissionsToEntity(
  entityId: string,
  input: AttachSlotToEntityInput,
  ctx: UserContext,
): Promise<AttachSlotToEntityResult> {
  const authorized = ctx.canAdminBypass || (await hasTool(ctx.effectiveUser.id, TOOLS.MISSION));
  if (!authorized) {
    throw new ForbiddenError("Vous n'avez pas accès à l'outil Missions");
  }

  const recipeIds = Array.isArray(input.recipeIds)
    ? input.recipeIds.filter((r): r is string => typeof r === "string" && !!r)
    : [];
  if (recipeIds.length === 0) {
    throw new ValidationError("Sélectionnez au moins une recette");
  }
  const accountId = input.accountId ?? null;

  // createSlot valide lui-même l'existence/l'archivage de la fiche (branche
  // propertyId) — pas de double-check ici.
  const createdIds: string[] = [];
  for (const recipeId of recipeIds) {
    const slot = await createSlot(
      { patternTemplateId: recipeId, accountId, propertyId: entityId },
      ctx,
      { requireAdmin: false },
    );
    createdIds.push(slot.id);
  }
  return { mode: "missions", createdIds, count: createdIds.length };
}

async function attachReelToEntity(
  entityId: string,
  entity: EntityAttachRow,
  input: AttachSlotToEntityInput,
  ctx: UserContext,
): Promise<AttachSlotToEntityResult> {
  const role = toUserRole(ctx.effectiveUser.role);

  // 404 anti-énumération : introuvable OU hors scope → même réponse (cohérent
  // avec getEntity / les routes rushs). Le 403 n'est renvoyé que si la fiche
  // est accessible mais que le rôle ne peut pas attacher (pas de fuite d'existence).
  if (!canUserAccessEntity(entity, role, ctx.effectiveUser.id)) {
    throw new NotFoundError("Fiche");
  }
  if (!canAttachSlotToEntity(role)) {
    throw new ForbiddenError("Votre rôle ne peut pas ajouter de reel");
  }

  // Un reel n'est JAMAIS patternless (resolveSlotEffectivePattern + triggers en
  // dépendent) et sa recette doit être compatible montage manuel (source
  // manual_rushes/external_upload) — une recette auto_template casserait la
  // chaîne de production du reel. À défaut de recette explicite, on prend le
  // binding actif par défaut compatible du compte.
  let patternBindingId = input.patternBindingId ?? null;
  if (patternBindingId) {
    const binding = await prisma.patternBinding.findUnique({
      where: { id: patternBindingId },
      select: { patternTemplate: { select: { source: true } } },
    });
    if (!binding) throw new ValidationError("Recette introuvable");
    if (!(REEL_ATTACHABLE_SOURCES as readonly string[]).includes(binding.patternTemplate.source)) {
      throw new ValidationError(
        "Cette recette (contenu automatique) ne peut pas être utilisée pour un reel",
      );
    }
  } else if (!input.patternTemplateId) {
    if (!entity.accountId) {
      throw new ValidationError(
        "Aucun compte associé à cette fiche : impossible de résoudre une recette de montage",
      );
    }
    const binding = await prisma.patternBinding.findFirst({
      where: {
        accountId: entity.accountId,
        isActive: true,
        patternTemplate: { source: { in: [...REEL_ATTACHABLE_SOURCES] } },
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!binding) {
      throw new ValidationError(
        "Aucune recette de montage disponible pour ce compte : choisissez une recette pour ce reel",
      );
    }
    patternBindingId = binding.id;
  }

  // Grammaire de champs par rôle : seul un ADMIN réel peut réassigner ou
  // programmer un reel à l'attache (cohérent avec ALLOWED_ENTITY_PATCH_FIELDS_BY_ROLE).
  // Un monteur/vidéaste attache un reel qui hérite des défauts de la fiche+recette
  // — sinon il pourrait assigner un CM arbitraire et lui ouvrir l'accès aux rushs.
  const isAdmin = ctx.canAdminBypass;
  const slotInput: CreateSlotInput = {
    eventId: entityId,
    patternBindingId,
    patternTemplateId: input.patternTemplateId ?? null,
    title: input.title ?? null,
    description: input.description ?? null,
    scheduledAt: isAdmin ? input.scheduledAt ?? null : null,
    propertyId: isAdmin ? input.propertyId ?? null : null,
    assigneeMonteurId: isAdmin ? input.assigneeMonteurId ?? null : null,
    assigneeCmId: isAdmin ? input.assigneeCmId ?? null : null,
    assigneeVideasteId: isAdmin ? input.assigneeVideasteId ?? null : null,
  };

  const slot = await createSlot(slotInput, ctx, { requireAdmin: false });

  await logEntityActivity(prisma, {
    entityId,
    actorId: ctx.actualUser.id,
    type: "SLOT_ATTACHED",
    payload: { slotId: slot.id },
  });

  return { mode: "reel", slot };
}

// ─── markEntityShot ───────────────────────────────────────────────────────────

type DbClient = typeof prisma | Prisma.TransactionClient;

/**
 * Logique pure (testable) : détermine la transition « tournage réalisé ».
 * Retourne null si la fiche ne doit pas passer SHOT (déjà SHOT/DONE/annulée).
 */
export function computeShotTransition(
  currentStatus: string | null,
): { nextStatus: "SHOT"; bumpReels: true } | null {
  if (currentStatus === "PLANNED") return { nextStatus: "SHOT", bumpReels: true };
  return null;
}

/** Statuts de reel bumpés vers IN_EDIT quand la fiche passe SHOT. */
export const REEL_STATUSES_BUMPED_ON_SHOT = ["PLANNED", "RUSHES_EXPECTED"] as const;

/**
 * Passe une fiche PLANNED → SHOT (premier rush uploadé, ou action manuelle) :
 * pose shotAt et bump les reels attachés {PLANNED,RUSHES_EXPECTED} → IN_EDIT.
 * Idempotent : no-op si la fiche n'est pas PLANNED. Accepte un tx client.
 */
export async function markEntityShot(
  db: DbClient,
  entityId: string,
  actorId: string | null,
): Promise<{ transitioned: boolean; bumpedReels: number }> {
  const entity = await db.entity.findUnique({
    where: { id: entityId },
    select: { id: true, status: true },
  });
  if (!entity) return { transitioned: false, bumpedReels: 0 };

  const transition = computeShotTransition(entity.status);
  if (!transition) return { transitioned: false, bumpedReels: 0 };

  await db.entity.update({
    where: { id: entityId },
    data: { status: transition.nextStatus, shotAt: new Date() },
  });

  const bump = await db.publicationSlot.updateMany({
    where: {
      shootEntityId: entityId,
      status: { in: [...REEL_STATUSES_BUMPED_ON_SHOT] },
    },
    data: { status: "IN_EDIT" },
  });

  await logEntityActivity(db, {
    entityId,
    actorId,
    type: "SHOT",
    payload: { bumpedReels: bump.count },
  });

  return { transitioned: true, bumpedReels: bump.count };
}
