/**
 * Service ShootEvent — création, lecture, modification, suppression et gestion
 * des reels rattachés à un événement de tournage.
 *
 * Convention identique au slotService : throw `ServiceError`, la route mappe
 * vers HTTP via `mapServiceError`. Scoping via `eventScope.ts`.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { UserContext } from "@/lib/userContext";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/services/_runtime/errors";
import { toUserRole } from "@/lib/permissions/role";
import {
  ALLOWED_EVENT_PATCH_FIELDS_BY_ROLE,
  canAttachReelToEvent,
  canCreateEvent,
  canUserAccessEvent,
  whereClauseForUserEvent,
} from "@/lib/permissions/eventScope";
import { logEventActivity } from "@/lib/services/event/eventActivity";
import { assertAssigneeRole, createSlot, type CreateSlotInput } from "@/lib/services/slot/slotService";
import { deleteR2Prefix } from "@/lib/r2";
import type { ShootEventStatus, ShootEventSummary } from "@/types/events";

// ─── Types I/O ────────────────────────────────────────────────────────────────

export interface CreateEventInput {
  title: string;
  /** Compte Instagram cible (requis). */
  accountId: string;
  /** Bien optionnel où se déroule le tournage. */
  propertyId?: string | null;
  /** Date/heure planifiée du tournage (ISO). */
  scheduledAt: string;
  endAt?: string | null;
  assigneeVideasteId?: string | null;
  defaultAssigneeMonteurId?: string | null;
  defaultAssigneeCmId?: string | null;
  notes?: string | null;
  brief?: string | null;
}

export interface ListEventsFilters {
  dateFrom?: string | null;
  dateTo?: string | null;
  accountId?: string | null;
  status?: string | null;
}

export interface UpdateEventInput {
  [key: string]: unknown;
}

/** Input d'attache d'un reel : recette + planning/overrides optionnels. */
export interface AttachReelInput {
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

const EVENT_STATUSES = ["PLANNED", "SHOT", "DONE", "CANCELLED"] as const;

/**
 * Sources de recette compatibles avec un reel d'événement : montage manuel des
 * rushs partagés. `auto_template` est exclu — il déclencherait un step « Rendu
 * vidéo » fantôme (aucun Render) et un CTA de rendu qui écraserait le montage.
 */
const REEL_ATTACHABLE_SOURCES = ["manual_rushes", "external_upload"] as const;

// ─── Helpers de validation ──────────────────────────────────────────────────

function parseDateOrThrow(value: string, label: string): Date {
  const d = new Date(value);
  if (isNaN(d.getTime())) throw new ValidationError(`${label} invalide`);
  return d;
}

async function assertAccountExists(accountId: string): Promise<void> {
  const account = await prisma.instagramAccount.findUnique({
    where: { id: accountId },
    select: { id: true },
  });
  if (!account) throw new NotFoundError("Compte");
}

async function assertPropertyUsable(propertyId: string): Promise<void> {
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { id: true, isArchived: true },
  });
  if (!property) throw new NotFoundError("Bien");
  if (property.isArchived) throw new ValidationError("Ce bien est archivé");
}

// Includes partagés
const eventListSelect = {
  id: true,
  title: true,
  accountId: true,
  propertyId: true,
  scheduledAt: true,
  endAt: true,
  status: true,
  shotAt: true,
  assigneeVideasteId: true,
  defaultAssigneeMonteurId: true,
  defaultAssigneeCmId: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  account: { select: { id: true, name: true, handle: true } },
  property: { select: { id: true, label: true } },
  assigneeVideaste: { select: { id: true, name: true } },
  _count: { select: { slots: true, rushes: { where: { deletedAt: null } } } },
} satisfies Prisma.ShootEventSelect;

// ─── createEvent ──────────────────────────────────────────────────────────────

/**
 * Crée un événement de tournage. Réservé aux ADMIN réels (canAdminBypass).
 * Seed optionnel des défauts monteur/CM depuis le binding actif du compte.
 */
export async function createEvent(input: CreateEventInput, ctx: UserContext) {
  if (!ctx.canAdminBypass || !canCreateEvent(toUserRole(ctx.effectiveUser.role))) {
    throw new ForbiddenError("Réservé aux administrateurs");
  }

  if (!input.accountId) throw new ValidationError("Un compte Instagram est requis");
  if (!input.title?.trim()) throw new ValidationError("Un titre est requis");
  if (!input.scheduledAt) throw new ValidationError("Une date de tournage est requise");

  await assertAccountExists(input.accountId);
  if (input.propertyId) await assertPropertyUsable(input.propertyId);

  const scheduledAt = parseDateOrThrow(input.scheduledAt, "Date de tournage");
  let endAt: Date | null = null;
  if (input.endAt) {
    endAt = parseDateOrThrow(input.endAt, "Date de fin");
    if (endAt < scheduledAt) throw new ValidationError("La fin ne peut pas précéder le début");
  }

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
  if (!seededMonteurId || !seededCmId) {
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

  const event = await prisma.$transaction(async (tx) => {
    const created = await tx.shootEvent.create({
      data: {
        title: input.title.trim(),
        accountId: input.accountId,
        propertyId: input.propertyId ?? null,
        scheduledAt,
        endAt,
        status: "PLANNED",
        assigneeVideasteId: input.assigneeVideasteId ?? null,
        defaultAssigneeMonteurId: seededMonteurId,
        defaultAssigneeCmId: seededCmId,
        notes: input.notes ?? null,
        brief: input.brief ?? null,
        createdByUserId: ctx.actualUser.id,
      },
      select: eventListSelect,
    });
    await logEventActivity(tx, {
      eventId: created.id,
      actorId: ctx.actualUser.id,
      type: "EVENT_CREATED",
      payload: { accountId: input.accountId, scheduledAt: input.scheduledAt },
    });
    return created;
  });

  return event;
}

// ─── listEvents ────────────────────────────────────────────────────────────────

export async function listEvents(filters: ListEventsFilters, ctx: UserContext) {
  const role = toUserRole(ctx.effectiveUser.role);
  const scope = whereClauseForUserEvent(role, ctx.effectiveUser.id);

  const dateWhere: Prisma.ShootEventWhereInput = {};
  if (filters.dateFrom || filters.dateTo) {
    dateWhere.scheduledAt = {};
    if (filters.dateFrom) dateWhere.scheduledAt.gte = parseDateOrThrow(filters.dateFrom, "dateFrom");
    if (filters.dateTo) dateWhere.scheduledAt.lte = parseDateOrThrow(filters.dateTo, "dateTo");
  }

  const events = await prisma.shootEvent.findMany({
    where: {
      ...scope,
      ...dateWhere,
      ...(filters.accountId ? { accountId: filters.accountId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    },
    orderBy: { scheduledAt: "asc" },
    take: 500,
    select: eventListSelect,
  });

  return events;
}

/**
 * Sérialise un événement de la liste vers la forme client `ShootEventSummary`
 * (dates ISO + compteurs aplatis). Utilisé côté SSR (page) ET côté API pour que
 * le refetch client reçoive exactement la même forme.
 */
export function toShootEventSummary(
  e: Awaited<ReturnType<typeof listEvents>>[number],
): ShootEventSummary {
  return {
    id: e.id,
    title: e.title,
    accountId: e.accountId,
    account: e.account,
    property: e.property,
    scheduledAt: e.scheduledAt.toISOString(),
    endAt: e.endAt ? e.endAt.toISOString() : null,
    status: e.status as ShootEventStatus,
    assigneeVideaste: e.assigneeVideaste,
    reelsCount: e._count.slots,
    rushesCount: e._count.rushes,
  };
}

// ─── getEvent ────────────────────────────────────────────────────────────────

export async function getEvent(id: string, ctx: UserContext) {
  const role = toUserRole(ctx.effectiveUser.role);

  const event = await prisma.shootEvent.findUnique({
    where: { id },
    select: {
      ...eventListSelect,
      brief: true,
      createdByUserId: true,
      defaultAssigneeMonteur: { select: { id: true, name: true } },
      defaultAssigneeCm: { select: { id: true, name: true } },
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
    },
  });

  // 404 anti-énumération : introuvable OU hors scope → même réponse.
  if (!event || !canUserAccessEvent(event, role, ctx.effectiveUser.id)) {
    throw new NotFoundError("Événement");
  }

  return event;
}

// ─── updateEvent ────────────────────────────────────────────────────────────────

export async function updateEvent(id: string, patch: UpdateEventInput, ctx: UserContext) {
  const role = toUserRole(ctx.effectiveUser.role);

  const existing = await prisma.shootEvent.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      scheduledAt: true,
      endAt: true,
      assigneeVideasteId: true,
      defaultAssigneeMonteurId: true,
      defaultAssigneeCmId: true,
      slots: { select: { assigneeMonteurId: true, assigneeCmId: true } },
    },
  });
  if (!existing || !canUserAccessEvent(existing, role, ctx.effectiveUser.id)) {
    throw new NotFoundError("Événement");
  }

  // Filtrer le patch par la liste blanche du rôle.
  const allowed = ALLOWED_EVENT_PATCH_FIELDS_BY_ROLE[role] ?? [];
  const data: Prisma.ShootEventUpdateInput & Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    if (allowed.includes(key)) data[key] = patch[key];
  }

  // Passage manuel à SHOT : on NE l'écrit pas via l'update générique — il doit
  // passer par markEventShot (pose shotAt + bump des reels PLANNED→IN_EDIT),
  // sinon l'événement serait SHOT avec shotAt=null et des reels bloqués.
  const wantsShot =
    typeof data.status === "string" && data.status === "SHOT" && existing.status !== "SHOT";
  if (wantsShot) delete data.status;

  if (Object.keys(data).length === 0 && !wantsShot) {
    throw new ValidationError("Aucun champ modifiable pour votre rôle");
  }

  // Validations ciblées.
  if (typeof data.status === "string" && !EVENT_STATUSES.includes(data.status as never)) {
    throw new ValidationError("Statut d'événement invalide");
  }
  if (data.scheduledAt) data.scheduledAt = parseDateOrThrow(String(data.scheduledAt), "Date");
  if (data.endAt) data.endAt = parseDateOrThrow(String(data.endAt), "Date de fin");
  // Cohérence date : la fin ne peut précéder le début (combine patch + existant).
  const effScheduledAt = (data.scheduledAt as Date | undefined) ?? existing.scheduledAt;
  const effEndAt = (data.endAt as Date | undefined) ?? existing.endAt;
  if (effScheduledAt && effEndAt && effEndAt < effScheduledAt) {
    throw new ValidationError("La fin ne peut pas précéder le début");
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
    let result: Prisma.ShootEventGetPayload<{ select: typeof eventListSelect }> | null = null;
    const hasGenericFields = Object.keys(data).length > 0;
    if (hasGenericFields) {
      result = await tx.shootEvent.update({ where: { id }, data, select: eventListSelect });
      await logEventActivity(tx, {
        eventId: id,
        actorId: ctx.actualUser.id,
        type: statusChanged ? "EVENT_STATUS_CHANGED" : "EVENT_UPDATED",
        payload: statusChanged ? { from: existing.status, to: data.status } : { fields: Object.keys(data) },
      });
    }
    if (wantsShot) {
      // Pose SHOT + shotAt + bump reels + log EVENT_SHOT, atomiquement.
      await markEventShot(tx, id, ctx.actualUser.id);
    }
    if (!result) {
      result = await tx.shootEvent.findUnique({ where: { id }, select: eventListSelect });
    }
    return result;
  });

  return updated;
}

// ─── deleteEvent ────────────────────────────────────────────────────────────────

/**
 * Supprime un événement. Admin only. Soft-cancel (status CANCELLED) si des reels
 * OU des rushs sont attachés (sinon le hard-delete cascade-supprimerait les
 * PublicationRush et orphelinerait les objets R2 partagés / les reels de leurs
 * rushs). Hard-delete seulement si aucun reel ni rush ; dans ce cas on nettoie
 * quand même le préfixe R2 de l'événement (best-effort) — r2Cleanup ne scanne
 * pas `shoot-events/`.
 */
export async function deleteEvent(id: string, ctx: UserContext) {
  if (!ctx.canAdminBypass) throw new ForbiddenError("Réservé aux administrateurs");

  const existing = await prisma.shootEvent.findUnique({
    where: { id },
    select: {
      id: true,
      _count: { select: { slots: true, rushes: { where: { deletedAt: null } } } },
    },
  });
  if (!existing) throw new NotFoundError("Événement");

  if (existing._count.slots > 0 || existing._count.rushes > 0) {
    const cancelled = await prisma.$transaction(async (tx) => {
      const result = await tx.shootEvent.update({
        where: { id },
        data: { status: "CANCELLED" },
        select: { id: true, status: true },
      });
      await logEventActivity(tx, {
        eventId: id,
        actorId: ctx.actualUser.id,
        type: "EVENT_CANCELLED",
        payload: { attachedReels: existing._count.slots, rushes: existing._count.rushes },
      });
      return result;
    });
    return { softCancelled: true, event: cancelled };
  }

  await prisma.shootEvent.delete({ where: { id } });
  // Nettoyage best-effort des objets R2 résiduels du tournage (aucun rush actif
  // mais des soft-deleted ont pu laisser des objets sous le préfixe).
  try {
    await deleteR2Prefix(`shoot-events/${id}/`);
  } catch (err) {
    console.warn(`[deleteEvent] cleanup R2 échoué pour shoot-events/${id}/ :`, err);
  }
  return { softCancelled: false };
}

// ─── attachReelToEvent ────────────────────────────────────────────────────────

/**
 * Attache un reel (PublicationSlot) à un événement. Délègue à createSlot avec
 * eventId (compte forcé + statut initial dérivé de l'état du tournage).
 * Autorisé pour ADMIN, MONTEUR et VIDEASTE ayant accès à l'événement.
 */
export async function attachReelToEvent(
  eventId: string,
  input: AttachReelInput,
  ctx: UserContext,
) {
  const role = toUserRole(ctx.effectiveUser.role);

  const event = await prisma.shootEvent.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      accountId: true,
      status: true,
      assigneeVideasteId: true,
      defaultAssigneeMonteurId: true,
      defaultAssigneeCmId: true,
      slots: { select: { assigneeMonteurId: true, assigneeCmId: true } },
    },
  });
  // 404 anti-énumération : introuvable OU hors scope → même réponse (cohérent
  // avec getEvent / les routes rushes). Le 403 n'est renvoyé que si l'événement
  // est accessible mais que le rôle ne peut pas attacher (pas de fuite d'existence).
  if (!event || !canUserAccessEvent(event, role, ctx.effectiveUser.id)) {
    throw new NotFoundError("Événement");
  }
  if (!canAttachReelToEvent(role)) {
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
        "Cette recette (contenu automatique) ne peut pas être utilisée pour un reel d'événement",
      );
    }
  } else if (!input.patternTemplateId) {
    const binding = await prisma.patternBinding.findFirst({
      where: {
        accountId: event.accountId,
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
  // programmer un reel à l'attache (cohérent avec ALLOWED_PATCH_FIELDS_BY_ROLE).
  // Un monteur/vidéaste attache un reel qui hérite des défauts événement+recette
  // — sinon il pourrait assigner un CM arbitraire et lui ouvrir l'accès aux rushs.
  const isAdmin = ctx.canAdminBypass;
  const slotInput: CreateSlotInput = {
    eventId,
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

  await logEventActivity(prisma, {
    eventId,
    actorId: ctx.actualUser.id,
    type: "EVENT_REEL_ATTACHED",
    payload: { slotId: slot.id },
  });

  return slot;
}

// ─── markEventShot ────────────────────────────────────────────────────────────

type DbClient = typeof prisma | Prisma.TransactionClient;

/**
 * Logique pure (testable) : détermine la transition « tournage réalisé ».
 * Retourne null si l'événement ne doit pas passer SHOT (déjà SHOT/DONE/annulé).
 */
export function computeShotTransition(
  currentStatus: string,
): { nextStatus: "SHOT"; bumpReels: true } | null {
  if (currentStatus === "PLANNED") return { nextStatus: "SHOT", bumpReels: true };
  return null;
}

/** Statuts de reel bumpés vers IN_EDIT quand l'événement passe SHOT. */
export const REEL_STATUSES_BUMPED_ON_SHOT = ["PLANNED", "RUSHES_EXPECTED"] as const;

/**
 * Passe un événement PLANNED → SHOT (premier rush uploadé, ou action manuelle) :
 * pose shotAt et bump les reels attachés {PLANNED,RUSHES_EXPECTED} → IN_EDIT.
 * Idempotent : no-op si l'événement n'est pas PLANNED. Accepte un tx client.
 */
export async function markEventShot(
  db: DbClient,
  eventId: string,
  actorId: string | null,
): Promise<{ transitioned: boolean; bumpedReels: number }> {
  const event = await db.shootEvent.findUnique({
    where: { id: eventId },
    select: { id: true, status: true },
  });
  if (!event) return { transitioned: false, bumpedReels: 0 };

  const transition = computeShotTransition(event.status);
  if (!transition) return { transitioned: false, bumpedReels: 0 };

  await db.shootEvent.update({
    where: { id: eventId },
    data: { status: transition.nextStatus, shotAt: new Date() },
  });

  const bump = await db.publicationSlot.updateMany({
    where: {
      eventId,
      status: { in: [...REEL_STATUSES_BUMPED_ON_SHOT] },
    },
    data: { status: "IN_EDIT" },
  });

  await logEventActivity(db, {
    eventId,
    actorId,
    type: "EVENT_SHOT",
    payload: { bumpedReels: bump.count },
  });

  return { transitioned: true, bumpedReels: bump.count };
}
