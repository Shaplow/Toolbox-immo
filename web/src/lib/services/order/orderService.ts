/**
 * Service Order — bons de commande.
 *
 * Cycle : SUBMITTED → VALIDATED → DONE, sorties REJECTED (réversible via
 * resubmit) et CANCELLED. Les fiches (Entity) portent les données, les slots
 * instanciés à la validation portent la production (sans date — banque, l'admin
 * les place ensuite).
 *
 * Scoping : ADMIN tout ; EXTERNAL_GENERATOR ses commandes via user.clientId
 * (session) ; autres rôles rien (cf. lib/permissions/orderScope.ts). 404
 * anti-énumération systématique hors périmètre.
 *
 * L'instanciation NE crée aucun nouveau chemin : elle réutilise
 * attachSlotToEntity (chemins reel/missions) et createSlot.
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
import { canUserAccessOrder, whereClauseForUserOrder } from "@/lib/permissions/orderScope";
import {
  attachSlotToEntity,
  prepareEntityCreate,
  type CreateEntityInput,
} from "@/lib/services/entity/entityService";
import { createSlot } from "@/lib/services/slot/slotService";
import { logEntityActivity } from "@/lib/services/entity/entityActivity";
import { requiredEntityTypeId } from "@/lib/publications/entityRequirement";
import { normalizeCustomFields, validateFieldValues } from "@/lib/customFields";
import { getMacroStep, MACRO_STEPS } from "@/lib/slots/macroStep";
import { TERMINAL_STATUSES } from "@/types/roles";
import type { SlotStatus } from "@/types/calendar";
import { safeJSON } from "@/lib/utils/json";

const MAX_NOTES = 2000;
const MAX_REASON = 2000;

export const ORDER_STATUSES = [
  "SUBMITTED",
  "VALIDATED",
  "REJECTED",
  "DONE",
  "CANCELLED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Une fiche est éditable par le client tant que la commande n'est pas validée. */
export const ORDER_EDITABLE_STATUSES: OrderStatus[] = ["SUBMITTED", "REJECTED"];

// ─── Types I/O ──────────────────────────────────────────────────────────────

export interface CreateOrderInput {
  orderTemplateId: string;
  /** Compte IG cible — requis si un des types de fiches exige un compte. */
  accountId?: string | null;
  notes?: string | null;
  /** Une entrée par item du modèle, matching par entityTypeId. */
  fiches: {
    entityTypeId: string;
    label: string;
    fields?: Record<string, string>;
    scheduledAt?: string | null;
  }[];
  /** ADMIN uniquement : créer au nom d'un client explicite. */
  clientId?: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Type « tournage-like » : planning + rushs (mode reel des fiches). */
function isShootType(t: { hasPlanning: boolean; hasRushes: boolean }): boolean {
  return t.hasPlanning && t.hasRushes;
}

/**
 * Résout le client d'une opération : session pour un externe, clientId
 * explicite pour un admin. Throw sinon.
 */
function resolveClientId(ctx: UserContext, explicitClientId?: string | null): string {
  if (ctx.canAdminBypass) {
    if (!explicitClientId) {
      throw new ValidationError("Un client est requis (création admin)");
    }
    return explicitClientId;
  }
  const role = toUserRole(ctx.effectiveUser.role);
  if (role !== "EXTERNAL_GENERATOR" || !ctx.effectiveUser.clientId) {
    throw new ForbiddenError("Réservé aux comptes externes rattachés à un client");
  }
  return ctx.effectiveUser.clientId;
}

const orderDetailSelect = {
  id: true,
  status: true,
  notes: true,
  rejectedReason: true,
  createdAt: true,
  updatedAt: true,
  validatedAt: true,
  clientId: true,
  client: { select: { id: true, name: true } },
  accountId: true,
  account: { select: { id: true, name: true, handle: true } },
  createdBy: { select: { id: true, name: true } },
  validatedBy: { select: { id: true, name: true } },
  orderTemplate: {
    select: {
      id: true,
      name: true,
      description: true,
      recipes: {
        select: {
          patternTemplateId: true,
          count: true,
          patternTemplate: { select: { label: true, source: true } },
        },
      },
    },
  },
  entities: {
    orderBy: { createdAt: "asc" as const },
    select: {
      id: true,
      typeId: true,
      label: true,
      fields: true,
      scheduledAt: true,
      validationStatus: true,
      relatedEntityId: true,
      type: {
        select: {
          id: true,
          name: true,
          icon: true,
          hasPlanning: true,
          hasRushes: true,
          fieldSchema: true,
        },
      },
    },
  },
  slots: {
    orderBy: { createdAt: "asc" as const },
    select: {
      id: true,
      title: true,
      status: true,
      scheduledAt: true,
      patternTemplate: { select: { label: true } },
      patternBinding: {
        select: { customLabel: true, patternTemplate: { select: { label: true } } },
      },
    },
  },
} satisfies Prisma.OrderSelect;

type OrderDetailRaw = Prisma.OrderGetPayload<{ select: typeof orderDetailSelect }>;

function slotLabel(slot: OrderDetailRaw["slots"][number]): string | null {
  return (
    slot.title ??
    slot.patternBinding?.customLabel ??
    slot.patternBinding?.patternTemplate.label ??
    slot.patternTemplate?.label ??
    null
  );
}

/**
 * Sérialise le détail d'une commande. `forExternal` réduit les slots à une
 * vue simplifiée (label + macro-étape + date) — aucun internal du pipeline
 * (statuts techniques, assignés, notes équipe) ne sort vers l'agence.
 */
function serializeOrder(order: OrderDetailRaw, opts: { forExternal: boolean }) {
  return {
    id: order.id,
    status: order.status as OrderStatus,
    notes: order.notes,
    rejectedReason: order.rejectedReason,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    validatedAt: order.validatedAt?.toISOString() ?? null,
    client: order.client,
    account: order.account,
    createdBy: opts.forExternal ? null : order.createdBy,
    validatedBy: opts.forExternal ? null : order.validatedBy,
    template: {
      id: order.orderTemplate.id,
      name: order.orderTemplate.name,
      description: order.orderTemplate.description,
      recipes: order.orderTemplate.recipes.map((r) => ({
        patternTemplateId: r.patternTemplateId,
        label: r.patternTemplate.label,
        source: r.patternTemplate.source,
        count: r.count,
      })),
    },
    entities: order.entities.map((e) => ({
      id: e.id,
      typeId: e.typeId,
      typeName: e.type.name,
      typeIcon: e.type.icon,
      hasPlanning: e.type.hasPlanning,
      label: e.label,
      fields: safeJSON<Record<string, string>>(e.fields, {}),
      fieldSchema: normalizeCustomFields(e.type.fieldSchema),
      scheduledAt: e.scheduledAt?.toISOString() ?? null,
      validationStatus: e.validationStatus,
    })),
    slots: order.slots.map((s) => {
      const step = getMacroStep(s.status as SlotStatus);
      const base = {
        label: slotLabel(s),
        step,
        stepLabel: MACRO_STEPS[step].label,
        scheduledAt: s.scheduledAt?.toISOString() ?? null,
      };
      // L'id et le statut technique ne sortent que pour l'équipe (liens
      // /publications/[id], placement de date).
      return opts.forExternal ? base : { ...base, id: s.id, status: s.status };
    }),
  };
}

export type OrderDetail = ReturnType<typeof serializeOrder>;

// ─── createOrder (submit) ───────────────────────────────────────────────────

export async function createOrder(input: CreateOrderInput, ctx: UserContext) {
  const clientId = resolveClientId(ctx, input.clientId);
  // Chemin admin : le clientId vient du body — vérifier qu'il existe (sinon
  // la création échouerait en P2003/500 au milieu de la transaction).
  if (ctx.canAdminBypass) {
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true },
    });
    if (!client) throw new ValidationError("Client introuvable");
  }

  if (!input.orderTemplateId) throw new ValidationError("Un modèle de commande est requis");
  const template = await prisma.orderTemplate.findUnique({
    where: { id: input.orderTemplateId },
    select: {
      id: true,
      name: true,
      isArchived: true,
      items: {
        orderBy: { position: "asc" },
        select: {
          entityTypeId: true,
          entityType: {
            select: {
              id: true,
              name: true,
              hasPlanning: true,
              hasAccount: true,
              hasRushes: true,
              fieldSchema: true,
            },
          },
        },
      },
      accesses: { select: { clientId: true } },
    },
  });
  // 404 uniforme : un modèle inexistant, archivé ou hors allowlist est
  // indistinguable pour un externe (anti-énumération).
  if (!template || template.isArchived) throw new NotFoundError("Modèle de commande");
  const clientAllowed = template.accesses.some((a) => a.clientId === clientId);
  if (!clientAllowed && !ctx.canAdminBypass) throw new NotFoundError("Modèle de commande");

  // Compte cible : requis si un type de fiche l'exige ; toujours ∈ comptes du client.
  const needsAccount = template.items.some((i) => i.entityType.hasAccount);
  let accountId: string | null = null;
  if (input.accountId) {
    const account = await prisma.instagramAccount.findFirst({
      where: { id: input.accountId, clientId },
      select: { id: true },
    });
    if (!account) throw new ValidationError("Compte Instagram invalide pour ce client");
    accountId = account.id;
  }
  if (needsAccount && !accountId) {
    throw new ValidationError("Un compte Instagram est requis pour cette commande");
  }

  // Une entrée fiche par item du modèle, matching par type, whitelist stricte
  // {label, fields, scheduledAt} — jamais assignés/statuts/compte arbitraire.
  const fichesByType = new Map(
    (input.fiches ?? []).filter((f) => f?.entityTypeId).map((f) => [f.entityTypeId, f]),
  );
  for (const key of fichesByType.keys()) {
    if (!template.items.some((i) => i.entityTypeId === key)) {
      throw new ValidationError("Fiche inattendue dans la commande");
    }
  }

  const notes =
    typeof input.notes === "string" && input.notes.trim()
      ? input.notes.trim().slice(0, MAX_NOTES)
      : null;
  const isExternalCreator = !ctx.canAdminBypass;

  // Préparation (validations complètes, hors tx) — une par item, dans l'ordre.
  const prepared: { data: Awaited<ReturnType<typeof prepareEntityCreate>>; isShoot: boolean }[] =
    [];
  for (const item of template.items) {
    const fiche = fichesByType.get(item.entityTypeId);
    if (!fiche) {
      throw new ValidationError(`La fiche « ${item.entityType.name} » est requise`);
    }
    const entityInput: CreateEntityInput = {
      typeId: item.entityTypeId,
      label: fiche.label,
      fields: fiche.fields,
      accountId: item.entityType.hasAccount ? accountId : null,
      scheduledAt: item.entityType.hasPlanning ? (fiche.scheduledAt ?? null) : null,
    };
    const data = await prepareEntityCreate(entityInput, {
      actorId: ctx.actualUser.id,
      isExternalCreator,
    });
    prepared.push({ data, isShoot: isShootType(item.entityType) });
  }

  const created = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        orderTemplateId: template.id,
        clientId,
        accountId,
        status: "SUBMITTED",
        notes,
        createdByUserId: ctx.actualUser.id,
      },
      select: { id: true },
    });

    // Création des fiches dans l'ordre du modèle + câblage relatedEntityId :
    // une fiche tournage pointe la fiche data non-tournage la plus proche
    // qui la précède (ex : Tournage → Bien).
    const createdIds: string[] = [];
    for (let i = 0; i < prepared.length; i++) {
      const { data, isShoot } = prepared[i];
      let relatedEntityId: string | null = null;
      if (isShoot) {
        for (let j = i - 1; j >= 0; j--) {
          if (!prepared[j].isShoot) {
            relatedEntityId = createdIds[j];
            break;
          }
        }
      }
      const entity = await tx.entity.create({
        data: { ...data, orderId: order.id, relatedEntityId },
        select: { id: true, typeId: true },
      });
      createdIds.push(entity.id);
      await logEntityActivity(tx, {
        entityId: entity.id,
        actorId: ctx.actualUser.id,
        type: "CREATED",
        payload: { typeId: entity.typeId, orderId: order.id },
      });
    }

    return order;
  });

  return getOrder(created.id, ctx);
}

// ─── listOrders / getOrder ──────────────────────────────────────────────────

export async function listOrders(
  filters: { status?: string | null; clientId?: string | null },
  ctx: UserContext,
) {
  const role = toUserRole(ctx.effectiveUser.role);
  const scope = whereClauseForUserOrder(role, ctx.effectiveUser.clientId);
  const orders = await prisma.order.findMany({
    where: {
      ...scope,
      ...(filters.status && ORDER_STATUSES.includes(filters.status as OrderStatus)
        ? { status: filters.status }
        : {}),
      // Filtre client : admin uniquement (le scope externe l'impose déjà).
      ...(ctx.canAdminBypass && filters.clientId ? { clientId: filters.clientId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      status: true,
      createdAt: true,
      validatedAt: true,
      client: { select: { id: true, name: true } },
      account: { select: { id: true, name: true, handle: true } },
      orderTemplate: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      _count: { select: { entities: true, slots: true } },
    },
  });
  return orders.map((o) => ({
    id: o.id,
    status: o.status as OrderStatus,
    createdAt: o.createdAt.toISOString(),
    validatedAt: o.validatedAt?.toISOString() ?? null,
    client: o.client,
    account: o.account,
    templateName: o.orderTemplate.name,
    createdByName: ctx.canAdminBypass ? (o.createdBy?.name ?? null) : null,
    entityCount: o._count.entities,
    slotCount: o._count.slots,
  }));
}

/** Charge une commande scopée (404 anti-énumération) — détail role-aware. */
export async function getOrder(id: string, ctx: UserContext): Promise<OrderDetail> {
  const role = toUserRole(ctx.effectiveUser.role);
  const order = await prisma.order.findUnique({ where: { id }, select: orderDetailSelect });
  if (!order || !canUserAccessOrder(order, role, ctx.effectiveUser.clientId)) {
    throw new NotFoundError("Commande");
  }
  return serializeOrder(order, { forExternal: !ctx.canAdminBypass });
}

// ─── updateOrderEntity ──────────────────────────────────────────────────────

/**
 * Édition d'une fiche de commande par le client (ou l'admin) — whitelist
 * {label, fields, scheduledAt} et uniquement tant que la commande est
 * SUBMITTED ou REJECTED. L'admin garde /fiches pour les éditions ultérieures.
 */
export async function updateOrderEntity(
  orderId: string,
  entityId: string,
  patch: { label?: string; fields?: Record<string, string>; scheduledAt?: string | null },
  ctx: UserContext,
) {
  const role = toUserRole(ctx.effectiveUser.role);
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, clientId: true, status: true },
  });
  if (!order || !canUserAccessOrder(order, role, ctx.effectiveUser.clientId)) {
    throw new NotFoundError("Commande");
  }
  if (!ORDER_EDITABLE_STATUSES.includes(order.status as OrderStatus)) {
    throw new ValidationError("Les fiches ne sont plus éditables (commande validée)");
  }

  const entity = await prisma.entity.findFirst({
    where: { id: entityId, orderId },
    select: {
      id: true,
      type: { select: { hasPlanning: true, fieldSchema: true } },
    },
  });
  if (!entity) throw new NotFoundError("Fiche");

  const data: Record<string, unknown> = {};
  if (patch.label !== undefined) {
    const label = typeof patch.label === "string" ? patch.label.trim() : "";
    if (!label) throw new ValidationError("Le libellé ne peut pas être vide");
    if (label.length > 200) throw new ValidationError("Libellé trop long (max 200 caractères)");
    data.label = label;
  }
  if (patch.fields !== undefined) {
    if (typeof patch.fields !== "object" || patch.fields === null || Array.isArray(patch.fields)) {
      throw new ValidationError("fields doit être un objet");
    }
    for (const [k, v] of Object.entries(patch.fields)) {
      if (typeof v !== "string" || v.length > 5000 || k.length > 100) {
        throw new ValidationError("Valeur de champ invalide");
      }
    }
    // Données client → required + choix fermés stricts, mais clés orphelines
    // TOLÉRÉES : le draft UI renvoie toutes les clés stockées — un schéma de
    // type modifié après soumission ne doit pas rendre la fiche insauvable.
    const err = validateFieldValues(
      normalizeCustomFields(entity.type.fieldSchema),
      patch.fields,
      { requireRequired: true, allowUnknownKeys: true },
    );
    if (err) throw new ValidationError(err);
    data.fields = JSON.stringify(patch.fields);
  }
  if (patch.scheduledAt !== undefined && entity.type.hasPlanning) {
    if (!patch.scheduledAt) throw new ValidationError("Une date est requise pour cette fiche");
    const d = new Date(patch.scheduledAt);
    if (isNaN(d.getTime())) throw new ValidationError("Date invalide");
    data.scheduledAt = d;
  }
  if (Object.keys(data).length === 0) {
    throw new ValidationError("Aucun champ à mettre à jour");
  }

  await prisma.$transaction(async (tx) => {
    await tx.entity.update({ where: { id: entityId }, data });
    await logEntityActivity(tx, {
      entityId,
      actorId: ctx.actualUser.id,
      type: "UPDATED",
      payload: { fields: Object.keys(data), orderId },
    });
  });

  return getOrder(orderId, ctx);
}

// ─── Cycle de vie ───────────────────────────────────────────────────────────

/** Charge une commande scopée pour une transition (sélection minimale). */
async function loadOrderForTransition(id: string, ctx: UserContext) {
  const role = toUserRole(ctx.effectiveUser.role);
  const order = await prisma.order.findUnique({
    where: { id },
    select: { id: true, clientId: true, status: true, accountId: true },
  });
  if (!order || !canUserAccessOrder(order, role, ctx.effectiveUser.clientId)) {
    throw new NotFoundError("Commande");
  }
  return order;
}

/**
 * Validation admin : approuve les fiches en attente + VALIDATED (transition
 * protégée par CAS — un double-clic / deux onglets ne valident qu'une fois),
 * puis instancie les slots (hors tx, échecs isolés remontés — même contrat
 * que attachMissionsToEntity : l'appelant DOIT afficher `failed`).
 *
 * Idempotent sur une commande déjà VALIDATED : la transition est sautée et
 * seule l'instanciation des slots MANQUANTS est relancée (retry naturel après
 * un échec partiel — bouton « Réessayer l'instanciation »).
 */
export async function validateOrder(id: string, ctx: UserContext) {
  if (!ctx.canAdminBypass) throw new ForbiddenError("Réservé aux administrateurs");
  const order = await loadOrderForTransition(id, ctx);
  if (
    order.status !== "SUBMITTED" &&
    order.status !== "REJECTED" &&
    order.status !== "VALIDATED"
  ) {
    throw new ValidationError("Seule une commande soumise (ou refusée) peut être validée");
  }

  // Le compte de la commande a pu être supprimé entre soumission et validation
  // (Order.accountId SetNull) — re-vérifier l'exigence réelle portée par les
  // fiches avant d'instancier des slots sans compte.
  if (!order.accountId) {
    const needsAccount = await prisma.entity.count({
      where: { orderId: id, type: { hasAccount: true } },
    });
    if (needsAccount > 0) {
      throw new ConflictError(
        "Le compte Instagram de la commande a été supprimé — rattachez un compte avant de valider",
      );
    }
  }

  if (order.status !== "VALIDATED") {
    const entities = await prisma.entity.findMany({
      where: { orderId: id },
      orderBy: { createdAt: "asc" },
      select: { id: true, validationStatus: true },
    });

    await prisma.$transaction(async (tx) => {
      // CAS en tête de tx : le perdant d'une course (double-clic, 2 onglets,
      // resubmit concurrent) ne matche plus le statut → 409, zéro écriture.
      const res = await tx.order.updateMany({
        where: { id, status: { in: ["SUBMITTED", "REJECTED"] } },
        data: {
          status: "VALIDATED",
          rejectedReason: null,
          validatedAt: new Date(),
          validatedByUserId: ctx.actualUser.id,
        },
      });
      if (res.count !== 1) {
        throw new ConflictError("La commande a changé d'état — rechargez la page");
      }
      for (const e of entities) {
        if (e.validationStatus === "PENDING_ADMIN" || e.validationStatus === "REJECTED") {
          await tx.entity.update({
            where: { id: e.id },
            data: { validationStatus: "APPROVED" },
          });
          await logEntityActivity(tx, {
            entityId: e.id,
            actorId: ctx.actualUser.id,
            type: "VALIDATION_APPROVED",
            payload: { from: e.validationStatus, to: "APPROVED", orderId: id },
          });
        }
      }
    });
  }

  const { createdSlotIds, failed } = await instantiateOrderSlots(id, ctx);
  return { order: await getOrder(id, ctx), createdSlotIds, failed };
}

/**
 * Instancie les slots d'une commande validée — routage par recette×count :
 *  - recette manual_rushes/external_upload + fiche tournage → chemin reel
 *    (attachSlotToEntity sur le tournage : compte forcé, assignés hérités,
 *    shootEntityId posé, needsRushesOverride=false) ;
 *  - sinon fiche data présente → chemin missions (propertyId = fiche) ;
 *  - sinon createSlot direct (recette globale seule).
 * Slots créés SANS date (banque) — placement manuel admin ensuite.
 */
async function instantiateOrderSlots(orderId: string, ctx: UserContext) {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      id: true,
      accountId: true,
      orderTemplate: {
        select: {
          recipes: {
            select: {
              count: true,
              patternTemplate: {
                select: {
                  id: true,
                  label: true,
                  source: true,
                  requiresProperty: true,
                  requiresEntityTypeId: true,
                },
              },
            },
          },
        },
      },
      entities: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          typeId: true,
          type: { select: { hasPlanning: true, hasRushes: true } },
        },
      },
    },
  });

  const shootFiche = order.entities.find((e) => isShootType(e.type)) ?? null;
  const dataFiches = order.entities.filter((e) => !isShootType(e.type));

  const createdSlotIds: string[] = [];
  const failed: { patternTemplateId: string; label: string; error: string }[] = [];

  for (const recipe of order.orderTemplate.recipes) {
    const pt = recipe.patternTemplate;
    // Fiche data : celle du type exigé par la recette si possible, sinon la première.
    const requiredTypeId = requiredEntityTypeId(pt);
    const dataFiche =
      (requiredTypeId ? dataFiches.find((e) => e.typeId === requiredTypeId) : null) ??
      dataFiches[0] ??
      null;

    // Idempotence (retry après échec partiel / double validation résiduelle) :
    // ne créer que les slots MANQUANTS pour cette recette. createSlot peut
    // convertir patternTemplateId en binding (couple compte+recette actif) —
    // on compte donc les deux formes.
    const existingCount = await prisma.publicationSlot.count({
      where: {
        orderId,
        OR: [
          { patternTemplateId: pt.id },
          { patternBinding: { patternTemplateId: pt.id } },
        ],
      },
    });

    for (let n = existingCount; n < recipe.count; n++) {
      try {
        const isReelSource = pt.source === "manual_rushes" || pt.source === "external_upload";
        if (isReelSource && shootFiche) {
          const result = await attachSlotToEntity(
            shootFiche.id,
            {
              patternTemplateId: pt.id,
              propertyId: dataFiche?.id ?? null,
              // Fallback si le type tournage n'a pas hasAccount (createSlot
              // force de toute façon le compte du tournage quand il en a un).
              accountId: order.accountId,
              orderId: order.id,
            },
            ctx,
          );
          if (result.mode === "reel") createdSlotIds.push(result.slot.id);
        } else if (dataFiche) {
          const result = await attachSlotToEntity(
            dataFiche.id,
            {
              recipeIds: [pt.id],
              accountId: order.accountId,
              orderId: order.id,
            },
            ctx,
          );
          if (result.mode === "missions") {
            createdSlotIds.push(...result.createdIds);
            for (const f of result.failed) {
              failed.push({ patternTemplateId: pt.id, label: f.label, error: f.error });
            }
          }
        } else {
          const slot = await createSlot(
            { patternTemplateId: pt.id, accountId: order.accountId, orderId: order.id },
            ctx,
          );
          createdSlotIds.push(slot.id);
        }
      } catch (err) {
        failed.push({
          patternTemplateId: pt.id,
          label: pt.label,
          error: err instanceof Error ? err.message : "Erreur inconnue",
        });
      }
    }
  }

  return { createdSlotIds, failed };
}

/** Refus admin — motif obligatoire, fiches PENDING_ADMIN → REJECTED. */
export async function rejectOrder(id: string, reason: string, ctx: UserContext) {
  if (!ctx.canAdminBypass) throw new ForbiddenError("Réservé aux administrateurs");
  const order = await loadOrderForTransition(id, ctx);
  if (order.status !== "SUBMITTED") {
    throw new ValidationError("Seule une commande soumise peut être refusée");
  }
  const cleanReason = typeof reason === "string" ? reason.trim().slice(0, MAX_REASON) : "";
  if (!cleanReason) throw new ValidationError("Un motif de refus est requis");

  const entities = await prisma.entity.findMany({
    where: { orderId: id, validationStatus: "PENDING_ADMIN" },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    // CAS : refus uniquement depuis SUBMITTED (course avec validate/cancel).
    const res = await tx.order.updateMany({
      where: { id, status: "SUBMITTED" },
      data: { status: "REJECTED", rejectedReason: cleanReason },
    });
    if (res.count !== 1) {
      throw new ConflictError("La commande a changé d'état — rechargez la page");
    }
    for (const e of entities) {
      await tx.entity.update({ where: { id: e.id }, data: { validationStatus: "REJECTED" } });
      await logEntityActivity(tx, {
        entityId: e.id,
        actorId: ctx.actualUser.id,
        type: "VALIDATION_REJECTED",
        payload: { comment: cleanReason, orderId: id },
      });
    }
  });

  return getOrder(id, ctx);
}

/** Re-soumission (client ou admin) après refus — fiches → PENDING_ADMIN. */
export async function resubmitOrder(id: string, ctx: UserContext) {
  const order = await loadOrderForTransition(id, ctx);
  if (order.status !== "REJECTED") {
    throw new ValidationError("Seule une commande refusée peut être re-soumise");
  }

  const entities = await prisma.entity.findMany({
    where: { orderId: id, validationStatus: "REJECTED" },
    select: { id: true, type: { select: { needsAdminValidation: true } } },
  });

  await prisma.$transaction(async (tx) => {
    // CAS : re-soumission uniquement depuis REJECTED — si un admin a validé
    // (ou annulé) entre-temps, on ne rouvre pas une commande déjà instanciée.
    const res = await tx.order.updateMany({
      where: { id, status: "REJECTED" },
      data: { status: "SUBMITTED", rejectedReason: null },
    });
    if (res.count !== 1) {
      throw new ConflictError("La commande a changé d'état — rechargez la page");
    }
    for (const e of entities) {
      await tx.entity.update({
        where: { id: e.id },
        data: {
          validationStatus: e.type.needsAdminValidation ? "PENDING_ADMIN" : null,
        },
      });
    }
  });

  return getOrder(id, ctx);
}

/**
 * Annulation — client : uniquement tant que SUBMITTED ; admin : toujours,
 * mais 409 si des slots non terminaux existent (même pattern que deleteEntity).
 */
export async function cancelOrder(id: string, ctx: UserContext) {
  const order = await loadOrderForTransition(id, ctx);
  if (order.status === "CANCELLED" || order.status === "DONE") {
    throw new ValidationError("Cette commande est déjà terminée");
  }
  // Externe : annulable tant que la commande n'est pas validée (SUBMITTED,
  // ou REJECTED si le client renonce plutôt que de re-soumettre).
  if (!ctx.canAdminBypass && order.status !== "SUBMITTED" && order.status !== "REJECTED") {
    throw new ValidationError(
      "La commande est déjà validée — contactez l'équipe pour l'annuler",
    );
  }
  if (ctx.canAdminBypass) {
    const activeSlots = await prisma.publicationSlot.count({
      where: { orderId: id, status: { notIn: [...TERMINAL_STATUSES] } },
    });
    if (activeSlots > 0) {
      throw new ConflictError(
        `${activeSlots} publication(s) actives sont liées — annulez-les ou terminez-les d'abord`,
      );
    }
  }

  // La demande de validation meurt avec la commande : les fiches encore
  // bloquantes (PENDING_ADMIN/REJECTED → assertEntityValidated) redeviennent
  // des fiches ordinaires immédiatement réutilisables.
  const blocked = await prisma.entity.findMany({
    where: { orderId: id, validationStatus: { in: ["PENDING_ADMIN", "REJECTED"] } },
    select: { id: true, validationStatus: true },
  });

  await prisma.$transaction(async (tx) => {
    // CAS : les statuts annulables dépendent du rôle (garde amont) — on
    // re-vérifie atomiquement pour fermer la course avec validate/reject.
    const res = await tx.order.updateMany({
      where: {
        id,
        status: ctx.canAdminBypass
          ? { notIn: ["CANCELLED", "DONE"] }
          : { in: ["SUBMITTED", "REJECTED"] },
      },
      data: { status: "CANCELLED" },
    });
    if (res.count !== 1) {
      throw new ConflictError("La commande a changé d'état — rechargez la page");
    }
    for (const e of blocked) {
      await tx.entity.update({ where: { id: e.id }, data: { validationStatus: null } });
      await logEntityActivity(tx, {
        entityId: e.id,
        actorId: ctx.actualUser.id,
        type: "UPDATED",
        payload: { validationCleared: e.validationStatus, orderId: id, reason: "order_cancelled" },
      });
    }
  });
  return getOrder(id, ctx);
}

/** Clôture manuelle admin. */
export async function markOrderDone(id: string, ctx: UserContext) {
  if (!ctx.canAdminBypass) throw new ForbiddenError("Réservé aux administrateurs");
  const order = await loadOrderForTransition(id, ctx);
  if (order.status !== "VALIDATED") {
    throw new ValidationError("Seule une commande validée peut être clôturée");
  }
  const res = await prisma.order.updateMany({
    where: { id, status: "VALIDATED" },
    data: { status: "DONE" },
  });
  if (res.count !== 1) {
    throw new ConflictError("La commande a changé d'état — rechargez la page");
  }
  return getOrder(id, ctx);
}
