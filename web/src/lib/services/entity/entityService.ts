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
  isValidatedForTeam,
  whereClauseForUserEntity,
} from "@/lib/permissions/entityScope";
import { logEntityActivity, type EntityActivityType } from "@/lib/services/entity/entityActivity";
import { assertAssigneeRole, createSlot, type CreateSlotInput } from "@/lib/services/slot/slotService";
import { hasTool, TOOLS } from "@/lib/permissions";
import { deleteR2Prefix } from "@/lib/r2";
import { safeJSON } from "@/lib/utils/json";
import { normalizeCustomFields, validateFieldValues } from "@/lib/customFields";
import { MAX_DECLINE_REASON } from "@/lib/entityAvailability";
import { MAX_ENTITY_LABEL, hasLabelTemplate, resolveEntityLabel } from "@/lib/entityLabel";

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
  /** Plage sur scheduledAt (ISO) — V3.2 : fetch par semaine du planning. */
  scheduledFrom?: string | null;
  scheduledTo?: string | null;
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
  /** Bon de commande d'origine — propagé à la colonne PublicationSlot.orderId. */
  orderId?: string | null;
}

export type AttachSlotToEntityResult =
  | {
      mode: "missions";
      createdIds: string[];
      count: number;
      /** Recettes dont la création a échoué — l'appelant DOIT les afficher (pas d'état partiel silencieux). */
      failed: { recipeId: string; label: string; error: string }[];
    }
  | { mode: "reel"; slot: Awaited<ReturnType<typeof createSlot>> };

const ENTITY_STATUSES = ["PLANNED", "SHOT", "DONE", "CANCELLED"] as const;

// ─── Validation bidirectionnelle (Entity.validationStatus) ──────────────────
//
// Direction encodée dans la valeur : PENDING_ADMIN (fiche créée par un client,
// l'admin doit approuver — BLOQUANT pour la création de slots, cf.
// assertEntityValidated dans slotService) / PENDING_CLIENT (fiche créée par
// l'équipe, soumise au client — informatif, non bloquant).

export type EntityValidationStatus =
  | "PENDING_ADMIN"
  | "PENDING_CLIENT"
  | "APPROVED"
  | "REJECTED"
  // Refus CLIENT — informatif comme PENDING_CLIENT : ne bloque PAS la création
  // de slots (assertEntityValidated), l'admin le voit et le solde (approve).
  | "REJECTED_CLIENT";

/**
 * Statut de validation initial d'une fiche selon la config du type et le
 * créateur. Pure — testée unitairement.
 */
export function initialValidationStatus(
  type: { needsAdminValidation: boolean; needsClientValidation: boolean },
  opts: { isExternalCreator: boolean },
): EntityValidationStatus | null {
  if (opts.isExternalCreator) {
    return type.needsAdminValidation ? "PENDING_ADMIN" : null;
  }
  return type.needsClientValidation ? "PENDING_CLIENT" : null;
}

/**
 * Sources de recette compatibles avec un reel de fiche : montage manuel des
 * rushs partagés. `auto_template` est exclu — il déclencherait un step « Rendu
 * vidéo » fantôme (aucun Render) et un CTA de rendu qui écraserait le montage.
 */
const REEL_ATTACHABLE_SOURCES = ["manual_rushes", "external_upload"] as const;

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
      labelTemplate: true,
    },
  },
  label: true,
  labelIsCustom: true,
  fields: true,
  isArchived: true,
  validationStatus: true,
  accountId: true,
  account: { select: { id: true, name: true, handle: true } },
  scheduledAt: true,
  endAt: true,
  shotAt: true,
  status: true,
  assigneeVideasteId: true,
  assigneeVideaste: { select: { id: true, name: true } },
  videasteConfirmation: true,
  videasteConfirmationAt: true,
  videasteDeclineReason: true,
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
  // `type: true` ramène tout l'EntityType, labelTemplate compris.
  type: true,
  label: true,
  labelIsCustom: true,
  fields: true,
  isArchived: true,
  validationStatus: true,
  accountId: true,
  account: { select: { id: true, name: true, handle: true } },
  scheduledAt: true,
  endAt: true,
  shotAt: true,
  status: true,
  assigneeVideasteId: true,
  assigneeVideaste: { select: { id: true, name: true } },
  videasteConfirmation: true,
  videasteConfirmationAt: true,
  videasteDeclineReason: true,
  defaultAssigneeMonteurId: true,
  defaultAssigneeMonteur: { select: { id: true, name: true } },
  defaultAssigneeCmId: true,
  defaultAssigneeCm: { select: { id: true, name: true } },
  notes: true,
  brief: true,
  relatedEntityId: true,
  related: { select: { id: true, label: true, typeId: true } },
  relatedOf: { select: { id: true, label: true, typeId: true } },
  // Commande d'origine : la commande pointe déjà vers ses fiches, le retour
  // manquait — impossible depuis une fiche de savoir d'où elle venait.
  orderId: true,
  order: { select: { id: true, orderTemplate: { select: { name: true } } } },
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
 * Assignés par défaut, résolus en cascade :
 *
 *   valeur explicite  →  recette (binding)  →  compte Instagram  →  vide
 *
 * Le compte porte l'équipe habituelle, la recette ne sert qu'à surcharger.
 * Sans ce dernier niveau, chaque recette repartait de zéro sur des champs dont
 * la réponse est presque toujours la même — d'où des recettes activées sans
 * personne dessus, et des tournages que nul ne voyait.
 *
 * Le vidéaste est traité comme le monteur et le CM : il était le seul à ne
 * jamais être seedé, alors que la worklist vidéaste lit
 * `Entity.assigneeVideasteId`.
 *
 * `recipeTemplateIds` limite les bindings consultés aux recettes réellement
 * commandées, dans leur ordre ; le premier qui renseigne un rôle le fournit.
 */
export async function resolveDefaultAssignees(
  accountId: string | null,
  recipeTemplateIds: string[] | undefined,
  provided: { videasteId: string | null; monteurId: string | null; cmId: string | null },
): Promise<{ videasteId: string | null; monteurId: string | null; cmId: string | null }> {
  const out = { ...provided };
  if (!accountId || (out.videasteId && out.monteurId && out.cmId)) return out;

  const bindings = await prisma.patternBinding.findMany({
    where: {
      accountId,
      isActive: true,
      ...(recipeTemplateIds?.length ? { patternTemplateId: { in: recipeTemplateIds } } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: {
      patternTemplateId: true,
      defaultAssigneeVideasteId: true,
      defaultAssigneeMonteurId: true,
      defaultAssigneeCmId: true,
    },
  });
  if (bindings.length === 0) {
    await applyAccountDefaults(accountId, out);
    return out;
  }

  for (const b of orderBindings(bindings, recipeTemplateIds)) {
    out.videasteId ??= b.defaultAssigneeVideasteId;
    out.monteurId ??= b.defaultAssigneeMonteurId;
    out.cmId ??= b.defaultAssigneeCmId;
    if (out.videasteId && out.monteurId && out.cmId) break;
  }
  await applyAccountDefaults(accountId, out);
  return out;
}

/**
 * Ordre de résolution : celui du modèle de commande quand il est connu (les
 * recettes y sont triées par `position`), sinon l'ordre de création des
 * bindings. Partagé par la résolution et la détection de divergences, pour que
 * « la première recette gagne » désigne la MÊME recette des deux côtés.
 */
function orderBindings<T extends { patternTemplateId: string }>(
  bindings: T[],
  recipeTemplateIds: string[] | undefined,
): T[] {
  if (!recipeTemplateIds?.length) return bindings;
  return recipeTemplateIds
    .map((id) => bindings.find((b) => b.patternTemplateId === id))
    .filter((b): b is T => b !== undefined);
}

export interface AssigneeConflict {
  role: "videaste" | "monteur" | "cm";
  /** Personne retenue (première recette qui renseigne le rôle) et sa recette. */
  keptName: string;
  keptRecipeLabel: string;
  /** Recettes suivantes qui désignaient quelqu'un d'autre. */
  ignored: { recipeLabel: string; name: string }[];
}

const CONFLICT_ROLES = [
  ["videaste", "defaultAssigneeVideasteId", "defaultAssigneeVideaste"],
  ["monteur", "defaultAssigneeMonteurId", "defaultAssigneeMonteur"],
  ["cm", "defaultAssigneeCmId", "defaultAssigneeCm"],
] as const;

/**
 * Divergences d'assignation entre les recettes commandées sur un même compte.
 *
 * `resolveDefaultAssignees` tranche silencieusement en faveur de la première
 * recette qui renseigne un rôle (ex. RVA1 et RVA2 sur un vidéaste, RVA3 sur un
 * autre : c'est celui de RVA1). Ce helper rend ce choix visible — il ne dépend
 * pas de l'état des fiches, donc il reste vrai après la validation, quand les
 * assignés sont déjà posés.
 */
export async function detectRecipeAssigneeConflicts(
  accountId: string | null,
  recipeTemplateIds: string[] | undefined,
): Promise<AssigneeConflict[]> {
  if (!accountId || !recipeTemplateIds?.length) return [];

  const bindings = await prisma.patternBinding.findMany({
    where: { accountId, isActive: true, patternTemplateId: { in: recipeTemplateIds } },
    orderBy: { createdAt: "asc" },
    select: {
      patternTemplateId: true,
      customLabel: true,
      patternTemplate: { select: { label: true } },
      defaultAssigneeVideasteId: true,
      defaultAssigneeVideaste: { select: { name: true } },
      defaultAssigneeMonteurId: true,
      defaultAssigneeMonteur: { select: { name: true } },
      defaultAssigneeCmId: true,
      defaultAssigneeCm: { select: { name: true } },
    },
  });
  if (bindings.length < 2) return [];

  const ordered = orderBindings(bindings, recipeTemplateIds);
  const conflicts: AssigneeConflict[] = [];

  for (const [role, idKey, relKey] of CONFLICT_ROLES) {
    let kept: { id: string; name: string; recipeLabel: string } | null = null;
    const ignored: { recipeLabel: string; name: string }[] = [];
    for (const b of ordered) {
      const id = b[idKey];
      if (!id) continue;
      const name = b[relKey]?.name ?? "un utilisateur";
      const recipeLabel = b.customLabel ?? b.patternTemplate.label;
      if (!kept) kept = { id, name, recipeLabel };
      else if (kept.id !== id) ignored.push({ recipeLabel, name });
    }
    if (kept && ignored.length > 0) {
      conflicts.push({
        role,
        keptName: kept.name,
        keptRecipeLabel: kept.recipeLabel,
        ignored,
      });
    }
  }
  return conflicts;
}

/** Équipe par défaut du compte — dernier niveau de la cascade. */
async function applyAccountDefaults(
  accountId: string,
  out: { videasteId: string | null; monteurId: string | null; cmId: string | null },
): Promise<void> {
  if (out.videasteId && out.monteurId && out.cmId) return;
  const account = await prisma.instagramAccount.findUnique({
    where: { id: accountId },
    select: {
      defaultAssigneeVideasteId: true,
      defaultAssigneeMonteurId: true,
      defaultAssigneeCmId: true,
    },
  });
  if (!account) return;
  out.videasteId ??= account.defaultAssigneeVideasteId;
  out.monteurId ??= account.defaultAssigneeMonteurId;
  out.cmId ??= account.defaultAssigneeCmId;
}

/**
 * Valide un input de création de fiche et prépare les données Prisma —
 * SANS le garde admin ni la transaction. Extraction réutilisée par :
 *  - `createEntity` (chemin admin classique) ;
 *  - `orderService.createOrder` (fiches d'un bon de commande, créées dans SA
 *    transaction, avec `isExternalCreator: true` → validationStatus
 *    PENDING_ADMIN si le type l'exige).
 * Toutes les lectures de validation (type, compte, fiche liée, rôles des
 * assignés, seed binding) se font hors transaction.
 */
export async function prepareEntityCreate(
  input: CreateEntityInput,
  opts: {
    actorId: string;
    isExternalCreator: boolean;
    orderId?: string | null;
    /** Recettes du modèle de commande — source des assignés par défaut. */
    recipeTemplateIds?: string[];
    /**
     * Instant de référence du libellé de repli. `createOrder` en passe UN seul
     * pour toute la commande : sinon une soumission à cheval sur minuit
     * produirait « Bien du 09/09 » et « Tournage — Bien du 10/09 ».
     */
    now?: Date;
  },
): Promise<Prisma.EntityUncheckedCreateInput> {
  if (!input.typeId) throw new ValidationError("Un type de fiche est requis");
  const type = await prisma.entityType.findUnique({ where: { id: input.typeId } });
  if (!type) throw new NotFoundError("Type de fiche");

  // Les champs sont validés AVANT le libellé : quand le type porte un modèle,
  // le libellé en dérive, donc il n'a de sens qu'une fois les champs sûrs.
  const fieldsErr = validateFields(input.fields);
  if (fieldsErr) throw new ValidationError(fieldsErr);

  // Validation contre le schéma du type : required + choix fermés + clés
  // inconnues (création = données neuves, on est strict).
  const schemaValuesErr = validateFieldValues(
    normalizeCustomFields(type.fieldSchema),
    (input.fields as Record<string, string> | undefined) ?? {},
    { requireRequired: true, allowUnknownKeys: false }
  );
  if (schemaValuesErr) throw new ValidationError(schemaValuesErr);

  // Libellé : dérivé du modèle du type, ou saisi à la main.
  //
  // `labelIsCustom = true` sur la branche manuelle donne l'invariant qui régit
  // tout le recalcul : true ⟺ ce texte n'a jamais été calculé. Il couvre aussi
  // les libellés secondaires d'une commande (« Tournage — … »), qui ne doivent
  // pas davantage être réécrits.
  let label: string;
  let labelIsCustom: boolean;
  if (hasLabelTemplate(type)) {
    // resolveEntityLabel ne rend jamais vide ni trop long : aucune erreur
    // possible ici, une commande client ne se bloque pas sur un champ non rempli.
    label = resolveEntityLabel(type, input.fields ?? {}, { now: opts.now });
    labelIsCustom = false;
  } else {
    const provided = input.label?.trim();
    if (!provided) throw new ValidationError("Un libellé est requis");
    if (provided.length > MAX_ENTITY_LABEL) {
      throw new ValidationError(`Libellé trop long (max ${MAX_ENTITY_LABEL} caractères)`);
    }
    label = provided;
    labelIsCustom = true;
  }

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

  // Seed des assignés par défaut depuis les recettes du compte.
  //
  // `recipeTemplateIds` (bon de commande) restreint la recherche aux recettes
  // réellement commandées ; sans lui (création manuelle) on retombe sur les
  // bindings actifs du compte, dans l'ordre de création.
  const seeded = await resolveDefaultAssignees(input.accountId ?? null, opts.recipeTemplateIds, {
    videasteId: input.assigneeVideasteId ?? null,
    monteurId: input.defaultAssigneeMonteurId ?? null,
    cmId: input.defaultAssigneeCmId ?? null,
  });

  return {
    typeId: input.typeId,
    label,
    labelIsCustom,
    fields: input.fields !== undefined ? JSON.stringify(input.fields) : "{}",
    validationStatus: initialValidationStatus(type, { isExternalCreator: opts.isExternalCreator }),
    orderId: opts.orderId ?? null,
    accountId: input.accountId ?? null,
    scheduledAt,
    endAt,
    status,
    assigneeVideasteId: seeded.videasteId,
    defaultAssigneeMonteurId: seeded.monteurId,
    defaultAssigneeCmId: seeded.cmId,
    notes: input.notes ?? null,
    brief: input.brief ?? null,
    relatedEntityId: input.relatedEntityId ?? null,
    createdByUserId: opts.actorId,
  };
}

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

  const data = await prepareEntityCreate(input, {
    actorId: ctx.actualUser.id,
    isExternalCreator: false,
  });

  const entity = await prisma.$transaction(async (tx) => {
    const created = await tx.entity.create({ data, select: entityListSelect });
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
      ...(filters.scheduledFrom || filters.scheduledTo
        ? {
            scheduledAt: {
              ...(filters.scheduledFrom ? { gte: new Date(filters.scheduledFrom) } : {}),
              ...(filters.scheduledTo ? { lt: new Date(filters.scheduledTo) } : {}),
            },
          }
        : {}),
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
  type: {
    select: {
      visibility: true,
      hasPlanning: true,
      fieldSchema: true,
      // Recalcul du libellé quand les champs changent (cf. plus bas).
      name: true,
      labelTemplate: true,
    },
  },
  label: true,
  labelIsCustom: true,
  fields: true,
  orderId: true,
  order: { select: { status: true } },
  status: true,
  scheduledAt: true,
  endAt: true,
  validationStatus: true,
  assigneeVideasteId: true,
  videasteConfirmation: true,
  defaultAssigneeMonteurId: true,
  defaultAssigneeCmId: true,
  shootSlots: {
    select: { assigneeMonteurId: true, assigneeCmId: true, assigneeVideasteId: true },
  },
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

  // ── Confirmation de disponibilité du vidéaste ──
  // La whitelist laisse passer les deux champs ; les gardes d'état sont ici.
  const confirmation = data.videasteConfirmation;
  // `null` explicite = RELANCE admin : la question redevient ouverte sans
  // réassigner. Avant, un refus était sans retour — le vidéaste ne pouvait plus
  // répondre (bouton masqué) et l'admin devait changer d'assigné pour débloquer.
  // Branche distincte du `undefined` (champ simplement absent du patch).
  const isAvailabilityReset = confirmation === null && "videasteConfirmation" in data;
  if (isAvailabilityReset) {
    if (!ctx.canAdminBypass) {
      throw new ForbiddenError("Seul un admin peut relancer une demande de disponibilité");
    }
    data.videasteConfirmationAt = null;
    data.videasteDeclineReason = null;
  } else if (confirmation !== undefined) {
    if (confirmation !== "CONFIRMED" && confirmation !== "DECLINED") {
      throw new ValidationError("Réponse de disponibilité invalide");
    }
    // La passerelle reel (entityScope) donne accès à la fiche à un vidéaste qui
    // n'est PAS celui du tournage : lui ne répond pas à la place de l'assigné.
    // Le test porte sur l'identité, pas sur le rôle : un compte ADMIN peut être
    // l'assigné (le select des vidéastes l'autorise) et doit pouvoir répondre.
    if (existing.assigneeVideasteId !== ctx.effectiveUser.id) {
      throw new ValidationError("Vous n'êtes pas le vidéaste de ce tournage");
    }
    if (!isValidatedForTeam(existing.validationStatus)) {
      throw new ConflictError("Ce tournage n'est pas encore validé");
    }
    data.videasteConfirmationAt = new Date();
    // Un motif ne survit pas à une confirmation : il décrivait l'indisponibilité.
    // Borné : texte libre écrit par un rôle non-admin, désormais saisissable
    // depuis deux surfaces (la fiche et la worklist /home).
    const reason =
      typeof data.videasteDeclineReason === "string"
        ? data.videasteDeclineReason.trim().slice(0, MAX_DECLINE_REASON)
        : null;
    data.videasteDeclineReason = confirmation === "DECLINED" ? (reason || null) : null;
  } else if (data.videasteDeclineReason !== undefined) {
    // Motif sans réponse : rien à enregistrer, on évite un update fantôme.
    delete data.videasteDeclineReason;
  }

  // Réassigner le tournage remet la confirmation à zéro : le nouveau vidéaste
  // n'a rien confirmé. Invariant central — sans ça, un tournage décliné puis
  // réassigné garderait l'ancienne réponse.
  const videasteChanged =
    data.assigneeVideasteId !== undefined && data.assigneeVideasteId !== existing.assigneeVideasteId;
  if (videasteChanged) {
    data.videasteConfirmation = null;
    data.videasteConfirmationAt = null;
    data.videasteDeclineReason = null;
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

  // Archiver une fiche d'une commande non terminale casserait sa validation /
  // instanciation (createSlot refuse une fiche archivée) — même garde que
  // deleteEntity.
  if (
    data.isArchived === true &&
    existing.orderId &&
    existing.order &&
    existing.order.status !== "CANCELLED" &&
    existing.order.status !== "DONE"
  ) {
    throw new ConflictError(
      "Cette fiche appartient à une commande en cours : annulez ou clôturez la commande avant de l'archiver.",
    );
  }

  // Validations ciblées.
  if (typeof data.label === "string") {
    const trimmed = data.label.trim();
    if (!trimmed) throw new ValidationError("Le libellé ne peut pas être vide");
    if (trimmed.length > MAX_ENTITY_LABEL)
      throw new ValidationError(`Libellé trop long (max ${MAX_ENTITY_LABEL} caractères)`);
    data.label = trimmed;
  }
  // Capturé AVANT le JSON.stringify : c'est l'état final des champs, donc la
  // base du recalcul de libellé plus bas.
  let nextFields: Record<string, string> | null = null;
  if (data.fields !== undefined) {
    const err = validateFields(data.fields);
    if (err) throw new ValidationError(err);
    // Contre le schéma du type : choix fermés validés ; clés orphelines
    // tolérées (schéma modifié après coup) et required non exigé en édition.
    const schemaErr = validateFieldValues(
      normalizeCustomFields(existing.type.fieldSchema),
      data.fields as Record<string, string>,
      {
        requireRequired: false,
        allowUnknownKeys: true,
        // Le formulaire renvoie l'objet `fields` COMPLET, pas un delta : sans
        // la comparaison à la base, une valeur numérique historique non
        // conforme bloquerait l'édition de n'importe quel AUTRE champ.
        previousValues: safeJSON<Record<string, string>>(existing.fields, {}),
      }
    );
    if (schemaErr) throw new ValidationError(schemaErr);
    nextFields = data.fields as Record<string, string>;
    data.fields = JSON.stringify(data.fields);
  }

  // ── Libellé automatique ──────────────────────────────────────────────────
  // Trois branches ORDONNÉES : le retour à l'auto prime, puis le renommage,
  // puis le recalcul.
  const typeHasTemplate = hasLabelTemplate(existing.type);
  if (data.labelIsCustom !== undefined) {
    if (data.labelIsCustom !== false) {
      throw new ValidationError("Le libellé personnalisé ne peut être que relâché");
    }
    if (!typeHasTemplate) {
      throw new ValidationError("Ce type de fiche n'a pas de modèle de libellé");
    }
    // Retour à l'automatique : on recalcule tout de suite, l'admin voit le
    // résultat sans second aller-retour.
    const fields = nextFields ?? safeJSON<Record<string, string>>(existing.fields, {});
    data.label = resolveEntityLabel(existing.type, fields);
  } else if (typeof data.label === "string" && data.label !== existing.label) {
    // Renommage manuel → verrou. La comparaison est essentielle : un formulaire
    // qui renvoie le libellé à l'identique ne doit pas tuer l'automatisation.
    data.labelIsCustom = true;
  } else if (nextFields && !existing.labelIsCustom && typeHasTemplate && data.label === undefined) {
    const next = resolveEntityLabel(existing.type, nextFields);
    // N'écrire que si ça change : pas d'updatedAt ni d'activité pour rien.
    if (next !== existing.label) data.label = next;
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
      const activityType = isAvailabilityReset
        ? ("VIDEASTE_RESET" as const)
        : confirmation
          ? confirmation === "CONFIRMED"
            ? ("VIDEASTE_CONFIRMED" as const)
            : ("VIDEASTE_DECLINED" as const)
          : statusChanged
            ? ("STATUS_CHANGED" as const)
            : ("UPDATED" as const);
      await logEntityActivity(tx, {
        entityId: id,
        actorId: ctx.actualUser.id,
        type: activityType,
        payload: isAvailabilityReset
          ? { previous: existing.videasteConfirmation ?? null }
          : confirmation
          ? { reason: data.videasteDeclineReason ?? null }
          : statusChanged
            ? { from: existing.status, to: data.status }
            : { fields: Object.keys(data) },
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

// ─── setEntityValidation ─────────────────────────────────────────────────────

export interface SetEntityValidationInput {
  action: "approve" | "reject" | "request";
  comment?: string | null;
}

/**
 * Applique une action de validation sur une fiche. Mécanisme UNIQUE de la
 * validation bidirectionnelle — la validation d'un bon de commande passe par
 * ici aussi (action de masse côté orderService).
 *
 *  - ADMIN réel : approve/reject sur toute fiche en attente ; approve possible
 *    sur une fiche REJECTED (après correction) ; `request` re-soumet la fiche
 *    au client (PENDING_CLIENT) si le type a la validation client.
 *  - EXTERNAL : approve/reject uniquement sur une fiche PENDING_CLIENT de son
 *    périmètre client (commande du client OU compte du client). 404
 *    anti-énumération hors périmètre.
 *  - Autres rôles : 404 (la validation admin est réservée aux admins réels).
 */
export async function setEntityValidation(
  id: string,
  input: SetEntityValidationInput,
  ctx: UserContext,
) {
  const role = toUserRole(ctx.effectiveUser.role);
  const entity = await prisma.entity.findUnique({
    where: { id },
    select: {
      id: true,
      validationStatus: true,
      type: { select: { needsAdminValidation: true, needsClientValidation: true } },
      order: { select: { clientId: true } },
      account: { select: { clientId: true } },
    },
  });
  if (!entity) throw new NotFoundError("Fiche");

  const current = entity.validationStatus;

  if (!ctx.canAdminBypass) {
    // Seul chemin non-admin : un compte externe qui répond à une demande de
    // validation client sur une fiche de son périmètre.
    if (role !== "EXTERNAL_GENERATOR") throw new NotFoundError("Fiche");
    if (input.action === "request") {
      throw new ForbiddenError("Réservé aux administrateurs");
    }
    // clientId lu en DB (pas depuis la session : pas de dépendance au refresh JWT).
    const user = await prisma.user.findUnique({
      where: { id: ctx.effectiveUser.id },
      select: { clientId: true },
    });
    const clientId = user?.clientId ?? null;
    const inScope =
      !!clientId &&
      (entity.order?.clientId === clientId || entity.account?.clientId === clientId);
    if (!inScope) throw new NotFoundError("Fiche");
    if (current !== "PENDING_CLIENT") {
      throw new ValidationError("Cette fiche n'attend pas de validation client");
    }
  }

  let next: EntityValidationStatus;
  let activityType: EntityActivityType;
  if (input.action === "approve") {
    if (!current) throw new ValidationError("Cette fiche n'attend aucune validation");
    next = "APPROVED";
    activityType = "VALIDATION_APPROVED";
  } else if (input.action === "reject") {
    if (current !== "PENDING_ADMIN" && current !== "PENDING_CLIENT") {
      throw new ValidationError("Cette fiche n'attend aucune validation");
    }
    // Direction encodée dans l'issue : un refus CLIENT reste informatif
    // (REJECTED_CLIENT, non bloquant) ; un refus ADMIN bloque (REJECTED).
    next = current === "PENDING_CLIENT" ? "REJECTED_CLIENT" : "REJECTED";
    activityType = "VALIDATION_REJECTED";
  } else if (input.action === "request") {
    if (!entity.type.needsClientValidation) {
      throw new ValidationError("Ce type de fiche n'a pas de validation client");
    }
    next = "PENDING_CLIENT";
    activityType = "VALIDATION_REQUESTED";
  } else {
    throw new ValidationError("Action de validation inconnue");
  }

  const comment =
    typeof input.comment === "string" && input.comment.trim()
      ? input.comment.trim().slice(0, 1000)
      : null;

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.entity.update({
      where: { id },
      data: { validationStatus: next },
      select: entityListSelect,
    });
    await logEntityActivity(tx, {
      entityId: id,
      actorId: ctx.actualUser.id,
      type: activityType,
      payload: { from: current, to: next, ...(comment ? { comment } : {}) },
    });
    return result;
  });

  return withParsedFields(updated);
}

// ─── deleteEntity ────────────────────────────────────────────────────────────

/**
 * Supprime une fiche. Admin only. Refuse (409) si des slots y sont rattachés
 * (source de données OU tournage) — l'admin doit d'abord les détacher — ou si
 * la fiche appartient à une commande non terminale (la validation/instanciation
 * s'appuie sur elle). Sinon hard-delete (cascade activités/rushes) + nettoyage
 * best-effort du préfixe R2.
 */
export async function deleteEntity(id: string, ctx: UserContext) {
  if (!ctx.canAdminBypass) throw new ForbiddenError("Réservé aux administrateurs");

  const existing = await prisma.entity.findUnique({
    where: { id },
    select: {
      id: true,
      orderId: true,
      order: { select: { status: true } },
      _count: { select: { slots: true, shootSlots: true } },
    },
  });
  if (!existing) throw new NotFoundError("Fiche");

  if (
    existing.orderId &&
    existing.order &&
    existing.order.status !== "CANCELLED" &&
    existing.order.status !== "DONE"
  ) {
    throw new ConflictError(
      "Cette fiche appartient à une commande en cours : annulez ou clôturez la commande avant de la supprimer.",
    );
  }

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
  validationStatus: true,
  assigneeVideasteId: true,
  defaultAssigneeMonteurId: true,
  defaultAssigneeCmId: true,
  shootSlots: {
    select: { assigneeMonteurId: true, assigneeCmId: true, assigneeVideasteId: true },
  },
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

  // Le templateId de la recette doit suivre sur le slot, sinon le drawer ne
  // propose pas « Ouvrir le formulaire de génération » pour les recettes auto.
  const templates = await prisma.patternTemplate.findMany({
    where: { id: { in: recipeIds } },
    select: { id: true, label: true, templateId: true },
  });
  const templateById = new Map(templates.map((t) => [t.id, t]));

  // createSlot valide lui-même l'existence/l'archivage de la fiche (branche
  // propertyId) — pas de double-check ici. Chaque recette est tentée
  // indépendamment : un échec (type de fiche incompatible, recette archivée…)
  // n'annule pas les autres, mais est REMONTÉ à l'appelant.
  const createdIds: string[] = [];
  const failed: { recipeId: string; label: string; error: string }[] = [];
  for (const recipeId of recipeIds) {
    const template = templateById.get(recipeId);
    if (!template) {
      failed.push({ recipeId, label: recipeId, error: "Recette introuvable" });
      continue;
    }
    try {
      const slot = await createSlot(
        {
          patternTemplateId: recipeId,
          accountId,
          propertyId: entityId,
          templateId: template.templateId,
          orderId: input.orderId ?? null,
        },
        ctx,
        { requireAdmin: false },
      );
      createdIds.push(slot.id);
      // Symétrique du chemin reel : sans ce log, une fiche data affiche un fil
      // d'activité vide alors qu'elle vient de recevoir N publications.
      await logEntityActivity(prisma, {
        entityId,
        actorId: ctx.actualUser.id,
        type: "SLOT_ATTACHED",
        payload: { slotId: slot.id, recipeId, label: template.label },
      });
    } catch (err) {
      failed.push({
        recipeId,
        label: template.label,
        error: err instanceof Error ? err.message : "Erreur inconnue",
      });
    }
  }
  return { mode: "missions", createdIds, count: createdIds.length, failed };
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
    orderId: input.orderId ?? null,
    // Fallback admin quand la fiche tournage n'a pas de compte (type sans
    // hasAccount) — createSlot force de toute façon le compte du tournage
    // quand il en a un.
    accountId: isAdmin ? input.accountId ?? null : null,
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
