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
import { MAX_ENTITY_LABEL, hasLabelTemplate, resolveEntityLabel } from "@/lib/entityLabel";
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
  resolveDefaultAssignees,
  detectRecipeAssigneeConflicts,
  type AssigneeConflict,
  type CreateEntityInput,
} from "@/lib/services/entity/entityService";
import { createSlot, deleteSlot } from "@/lib/services/slot/slotService";
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
  /**
   * Vidéos retenues parmi les recettes OPTIONNELLES du modèle. Les recettes
   * imposées sont instanciées quoi qu'il arrive — ne jamais croire le client
   * sur ce point. Omettre le tableau = comportement d'avant (les optionnelles
   * suivent leur `defaultSelected`).
   */
  recipes?: { patternTemplateId: string; count: number }[];
  /** ADMIN uniquement : créer au nom d'un client explicite. */
  clientId?: string | null;
  /**
   * Type de tournage retenu, quand le modèle en propose. Il commande quelles
   * vidéos sont instanciées — pas seulement lesquelles étaient affichées.
   */
  shootTypeId?: string | null;
}

/**
 * Corps JSON brut → `CreateOrderInput`.
 *
 * Ici et pas dans la route parce que c'est là qu'un champ se perd sans bruit :
 * `recipes` était envoyé par le formulaire, traité par le service, couvert par
 * les tests — et la route ne le lisait pas. Toutes les commandes retombaient
 * donc sur `defaultSelected`, et décocher une vidéo n'avait aucun effet. Le
 * repo n'ayant pas de test de routes, extraire ce parsing est ce qui le rend
 * vérifiable.
 */
export function parseCreateOrderInput(body: Record<string, unknown>): CreateOrderInput {
  return {
    orderTemplateId: typeof body.orderTemplateId === "string" ? body.orderTemplateId : "",
    accountId: typeof body.accountId === "string" && body.accountId ? body.accountId : null,
    notes: typeof body.notes === "string" ? body.notes : null,
    clientId: typeof body.clientId === "string" && body.clientId ? body.clientId : null,
    shootTypeId: typeof body.shootTypeId === "string" && body.shootTypeId ? body.shootTypeId : null,
    /**
     * Vidéos retenues parmi les OPTIONNELLES.
     *
     * Ce champ n'était pas lu : le formulaire l'envoyait, le service savait le
     * traiter, les tests le couvraient — et la route le jetait. Toutes les
     * commandes retombaient donc silencieusement sur `defaultSelected`, et
     * décocher une vidéo n'avait aucun effet. `undefined` (et non `[]`) quand
     * le tableau est absent : c'est ce qui distingue « rien envoyé, applique
     * les défauts » de « tout décoché ».
     */
    recipes: Array.isArray(body.recipes)
      ? (body.recipes as Record<string, unknown>[]).map((r) => ({
          patternTemplateId: typeof r?.patternTemplateId === "string" ? r.patternTemplateId : "",
          count: typeof r?.count === "number" ? r.count : NaN,
        }))
      : undefined,
    fiches: Array.isArray(body.fiches)
      ? (body.fiches as Record<string, unknown>[]).map((f) => ({
          entityTypeId: typeof f?.entityTypeId === "string" ? f.entityTypeId : "",
          label: typeof f?.label === "string" ? f.label : "",
          fields:
            f?.fields !== undefined && typeof f.fields === "object" && f.fields !== null
              ? (f.fields as Record<string, string>)
              : undefined,
          scheduledAt:
            typeof f?.scheduledAt === "string" && f.scheduledAt ? f.scheduledAt : null,
        }))
      : [],
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Combien de vidéos une ligne de recette déclenche RÉELLEMENT pour une commande.
 *
 * Trois cas, dans cet ordre :
 *  - recette imposée → `count`, quoi qu'ait envoyé le client ;
 *  - recette optionnelle avec une sélection → la quantité cochée (0 = refusée) ;
 *  - recette optionnelle SANS sélection → repli sur `defaultSelected`.
 *
 * Ce dernier cas couvre les commandes antérieures à la migration : elles n'ont
 * aucune `OrderRecipeSelection` et doivent se comporter exactement comme avant.
 * C'est la raison pour laquelle `isOptional` vaut `false` par défaut — aucun
 * backfill n'est nécessaire.
 */
export function effectiveRecipeCount(
  recipe: { count: number; isOptional: boolean; defaultSelected: boolean },
  selectionByPattern: Map<string, number>,
  patternTemplateId?: string,
): number {
  if (!recipe.isOptional) return recipe.count;
  const selected = patternTemplateId ? selectionByPattern.get(patternTemplateId) : undefined;
  if (selected !== undefined) return Math.min(selected, recipe.count);
  return recipe.defaultSelected ? recipe.count : 0;
}

/**
 * Les vidéos d'un modèle qui concernent le type de tournage retenu.
 *
 * `shootTypeId: null` sur une ligne = vidéo COMMUNE, proposée quel que soit le
 * type — c'est la valeur de toutes les lignes existantes, donc le comportement
 * d'avant est strictement préservé sans backfill.
 *
 * Ce filtre doit vivre ICI, côté service, et pas seulement dans le formulaire :
 * filtré uniquement à l'affichage, un négo qui coche RVA1 verrait aussi naître
 * les vidéos des autres types à la validation.
 */
export function recipesForShootType<T extends { shootTypeId?: string | null }>(
  recipes: T[],
  shootTypeId: string | null | undefined,
): T[] {
  return recipes.filter(
    // `undefined` traité comme `null` — donc COMMUNE, donc visible. Le filtre
    // échoue ouvert : une projection qui oublierait `shootTypeId` afficherait
    // une vidéo de trop, au lieu de toutes les faire disparaître en silence.
    // Même raisonnement que le SetNull de la clé étrangère.
    (r) => r.shootTypeId === null || r.shootTypeId === undefined || r.shootTypeId === shootTypeId,
  );
}

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
  shootTypeId: true,
  shootType: { select: { id: true, label: true, videosDecidedLater: true } },
  orderTemplate: {
    select: {
      id: true,
      name: true,
      description: true,
      recipes: {
        select: {
          patternTemplateId: true,
          count: true,
          isOptional: true,
          defaultSelected: true,
          minCount: true,
          shootTypeId: true,
          patternTemplate: {
            select: { label: true, clientLabel: true, source: true },
          },
        },
        orderBy: { position: "asc" },
      },
    },
  },
  recipeSelections: { select: { patternTemplateId: true, count: true } },
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
      assigneeVideasteId: true,
      type: {
        select: {
          id: true,
          name: true,
          icon: true,
          hasPlanning: true,
          hasRushes: true,
          hasAssignees: true,
          fieldSchema: true,
          labelTemplate: true,
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
        // `publishTime` : heure de publication prévue par la recette, pour
        // pré-remplir le placement plutôt qu'un 09:00 générique.
        select: {
          customLabel: true,
          publishTime: true,
          patternTemplate: { select: { label: true } },
        },
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
    shootType: order.shootType
      ? {
          id: order.shootType.id,
          label: order.shootType.label,
          videosDecidedLater: order.shootType.videosDecidedLater,
        }
      : null,
    template: {
      id: order.orderTemplate.id,
      name: order.orderTemplate.name,
      description: order.orderTemplate.description,
      // Le récap ne montre que les vidéos du type retenu — celles des autres
      // types n'ont jamais été proposées ni instanciées pour cette commande.
      recipes: recipesForShootType(order.orderTemplate.recipes, order.shootTypeId).map((r) => ({
        patternTemplateId: r.patternTemplateId,
        // Libellé CLIENT quand il existe : « RVA1 » est du jargon interne, et
        // c'est ce que le récap affichait.
        label: r.patternTemplate.clientLabel ?? r.patternTemplate.label,
        source: r.patternTemplate.source,
        count: r.count,
        isOptional: r.isOptional,
        defaultSelected: r.defaultSelected,
        minCount: r.minCount,
        // Ce qui sera réellement instancié : le bouton « Réessayer » et le
        // récap doivent compter ça, pas la somme brute des `count`.
        effectiveCount: effectiveRecipeCount(
          r,
          new Map(order.recipeSelections.map((sel) => [sel.patternTemplateId, sel.count])),
          r.patternTemplateId,
        ),
      })),
    },
    entities: order.entities.map((e) => ({
      id: e.id,
      typeId: e.typeId,
      typeName: e.type.name,
      // Non vide = le libellé est calculé : le formulaire n'en propose pas la saisie.
      labelTemplate: e.type.labelTemplate,
      typeIcon: e.type.icon,
      hasPlanning: e.type.hasPlanning,
      label: e.label,
      fields: safeJSON<Record<string, string>>(e.fields, {}),
      fieldSchema: normalizeCustomFields(e.type.fieldSchema),
      scheduledAt: e.scheduledAt?.toISOString() ?? null,
      validationStatus: e.validationStatus,
      // Un tournage sans vidéaste n'apparaît dans la worklist de personne :
      // l'équipe doit le voir sur la commande, pas seulement dans un toast.
      missingVideaste: opts.forExternal
        ? false
        : isShootType(e.type) && e.type.hasAssignees && !e.assigneeVideasteId,
    })),
    slots: order.slots.map((s) => {
      const step = getMacroStep(s.status as SlotStatus);
      const base = {
        label: slotLabel(s),
        step,
        stepLabel: MACRO_STEPS[step].label,
        scheduledAt: s.scheduledAt?.toISOString() ?? null,
        defaultTime: s.patternBinding?.publishTime ?? null,
      };
      // L'id et le statut technique ne sortent que pour l'équipe (liens
      // /publications/[id], placement de date).
      return opts.forExternal ? base : { ...base, id: s.id, status: s.status };
    }),
  };
}

export type OrderDetail = ReturnType<typeof serializeOrder> & {
  /** Présent uniquement pour l'admin (cf. getOrder). */
  assigneeConflicts?: AssigneeConflict[];
};

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
              // Libellé dérivé des champs quand le type en porte un modèle.
              labelTemplate: true,
            },
          },
        },
      },
      accesses: { select: { clientId: true } },
      shootTypes: { select: { id: true }, orderBy: { position: "asc" } },
      // Recettes du modèle : source des assignés par défaut des fiches, et
      // référentiel de validation de la sélection du négo.
      recipes: {
        select: {
          patternTemplateId: true,
          count: true,
          isOptional: true,
          defaultSelected: true,
          minCount: true,
          shootTypeId: true,
        },
        orderBy: { position: "asc" },
      },
    },
  });
  // 404 uniforme : un modèle inexistant, archivé ou hors allowlist est
  // indistinguable pour un externe (anti-énumération).
  if (!template || template.isArchived) throw new NotFoundError("Modèle de commande");
  const clientAllowed = template.accesses.some((a) => a.clientId === clientId);
  if (!clientAllowed && !ctx.canAdminBypass) throw new NotFoundError("Modèle de commande");

  /**
   * Type de tournage : requis dès que le modèle en propose, puisqu'il commande
   * quelles vidéos naissent. Un modèle qui n'en propose aucun se comporte
   * exactement comme avant — c'est le cas de tous les modèles existants.
   */
  let shootTypeId: string | null = null;
  if (template.shootTypes.length > 0) {
    if (!input.shootTypeId) {
      throw new ValidationError("Choisissez un type de tournage");
    }
    if (!template.shootTypes.some((t) => t.id === input.shootTypeId)) {
      throw new ValidationError("Type de tournage inconnu pour ce modèle de commande");
    }
    shootTypeId = input.shootTypeId;
  }

  // Toute la suite ne raisonne QUE sur les vidéos du type retenu : la
  // validation de la sélection du négo comme les assignés par défaut.
  const templateRecipes = recipesForShootType(template.recipes, shootTypeId);

  /**
   * Compte cible — OPTIONNEL désormais, et plus jamais demandé au demandeur.
   *
   * Il se pose au placement sur le calendrier (`assignSlotAccount`) : une même
   * vidéo peut atterrir sur plusieurs comptes, et ce n'est pas au négo de
   * trancher. Le champ reste accepté par l'API (commandes créées par script,
   * ou par un admin qui sait déjà où ça va) mais aucune surface ne l'envoie.
   *
   * La contrainte qui demeure est la seule qui protège : un compte fourni doit
   * appartenir au client de la commande.
   *
   * Conséquence assumée : sans compte, les fiches et publications naissent sans
   * assignés par défaut (ils vivent sur les bindings, per-compte). Ils arrivent
   * avec le compte, au placement. Pas de repli « le client n'a qu'un compte,
   * prenons-le » : ce serait réintroduire l'implicite qu'on supprime.
   */
  let accountId: string | null = null;
  if (input.accountId) {
    const account = await prisma.instagramAccount.findFirst({
      where: { id: input.accountId, clientId },
      select: { id: true },
    });
    if (!account) throw new ValidationError("Compte Instagram invalide pour ce client");
    accountId = account.id;
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

  // Un seul instant de référence pour toute la commande : deux appels à
  // `new Date()` de part et d'autre de minuit produiraient « Bien du 09/09 »
  // et « Tournage — Bien du 10/09 ».
  const now = new Date();

  // Libellé de référence = celui de la première fiche du modèle. Les fiches
  // suivantes en dérivent (« Tournage — 12 rue des Lilas ») au lieu d'être
  // ressaisies : une seule saisie, et deux fiches distinguables partout au lieu
  // de deux homonymes.
  //
  // Quand le type de la fiche primaire porte un modèle de libellé, la référence
  // est le libellé CALCULÉ — avec repli, jamais vide : sinon une primaire au
  // rendu vide passerait pendant que la secondaire échouerait sur un label vide.
  const primaryItem = template.items[0];
  const primaryFiche = primaryItem ? fichesByType.get(primaryItem.entityTypeId) : undefined;
  const primaryLabel = !primaryItem
    ? ""
    : hasLabelTemplate(primaryItem.entityType)
      ? resolveEntityLabel(primaryItem.entityType, primaryFiche?.fields ?? {}, { now })
      : (primaryFiche?.label?.trim() ?? "");

  // Préparation (validations complètes, hors tx) — une par item, dans l'ordre.
  const prepared: { data: Awaited<ReturnType<typeof prepareEntityCreate>>; isShoot: boolean }[] =
    [];
  for (const [index, item] of template.items.entries()) {
    const fiche = fichesByType.get(item.entityTypeId);
    if (!fiche) {
      throw new ValidationError(`La fiche « ${item.entityType.name} » est requise`);
    }
    // Seule la première fiche porte un libellé saisi ; les autres sont
    // dérivées côté serveur — ce que le client envoie pour elles est ignoré.
    //
    // Un type qui porte son propre modèle l'emporte sur la dérivation : on
    // laisse alors `prepareEntityCreate` calculer, d'où le libellé vide ici.
    const label = hasLabelTemplate(item.entityType)
      ? ""
      : index === 0
        ? fiche.label
        : primaryLabel
          ? `${item.entityType.name} — ${primaryLabel}`
          : fiche.label;
    const entityInput: CreateEntityInput = {
      typeId: item.entityTypeId,
      label,
      fields: fiche.fields,
      accountId: item.entityType.hasAccount ? accountId : null,
      scheduledAt: item.entityType.hasPlanning ? (fiche.scheduledAt ?? null) : null,
    };
    const data = await prepareEntityCreate(entityInput, {
      actorId: ctx.actualUser.id,
      isExternalCreator,
      // Les assignés par défaut viennent des recettes réellement commandées,
      // pas d'un binding arbitraire du compte.
      // Du type retenu seulement : une recette d'un autre type n'a aucune
      // raison de fournir le monteur par défaut de cette commande.
      recipeTemplateIds: templateRecipes.map((r) => r.patternTemplateId),
      now,
      // Le compte ne se choisit plus à la commande : exiger celui de la fiche
      // bloquerait toute commande dès qu'un type coche `hasAccount` (c'est le
      // cas du Tournage). Il arrive au placement, sur les publications.
      accountDeferred: !accountId,
    });
    prepared.push({ data, isShoot: isShootType(item.entityType) });
  }

  /**
   * Sélection de vidéos — validée AVANT la transaction.
   *
   * Le client ne décide que des recettes marquées optionnelles : envoyer une
   * recette imposée (ou inconnue) est une erreur, pas une préférence. Et la
   * quantité reste bornée par ce que l'admin a paramétré.
   */
  const recipeSelections: { patternTemplateId: string; count: number }[] = [];
  if (input.recipes?.length) {
    const byId = new Map(templateRecipes.map((r) => [r.patternTemplateId, r]));
    for (const wanted of input.recipes) {
      const recipe = byId.get(wanted.patternTemplateId);
      if (!recipe) {
        // Couvre aussi « cette vidéo appartient à un autre type de tournage » :
        // du point de vue de cette commande, elle n'existe pas.
        throw new ValidationError("Vidéo demandée hors du modèle de commande");
      }
      if (!recipe.isOptional) {
        throw new ValidationError("Cette vidéo est imposée par le modèle et ne se choisit pas");
      }
      const count = Number(wanted.count);
      if (!Number.isInteger(count) || count < recipe.minCount || count > recipe.count) {
        throw new ValidationError(
          `Quantité invalide (attendu entre ${recipe.minCount} et ${recipe.count})`,
        );
      }
      recipeSelections.push({ patternTemplateId: recipe.patternTemplateId, count });
    }
    // Une optionnelle absente du payload est un refus EXPLICITE : sans cette
    // ligne à 0, elle retomberait sur `defaultSelected` et serait instanciée
    // alors que le négo l'a décochée.
    for (const recipe of templateRecipes) {
      if (!recipe.isOptional) continue;
      if (recipeSelections.some((s) => s.patternTemplateId === recipe.patternTemplateId)) continue;
      recipeSelections.push({ patternTemplateId: recipe.patternTemplateId, count: 0 });
    }
  }

  const created = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        orderTemplateId: template.id,
        clientId,
        accountId,
        shootTypeId,
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

    // Même transaction que les fiches : une commande à moitié écrite (fiches
    // sans sélection) instancierait les mauvaises vidéos à la validation.
    if (recipeSelections.length > 0) {
      await tx.orderRecipeSelection.createMany({
        data: recipeSelections.map((sel) => ({ ...sel, orderId: order.id })),
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
      // Première fiche saisie : sans elle, deux commandes du même modèle sont
      // strictement identiques dans la liste.
      entities: {
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { label: true },
      },
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
    primaryEntityLabel: o.entities[0]?.label ?? null,
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
  const serialized = serializeOrder(order, { forExternal: !ctx.canAdminBypass });
  if (!ctx.canAdminBypass) return serialized;

  // Divergences d'assignation entre recettes commandées — admin seulement :
  // c'est lui qui arbitre, et le client n'a pas à voir l'équipe interne.
  const assigneeConflicts = await detectRecipeAssigneeConflicts(
    order.accountId,
    recipesForShootType(order.orderTemplate.recipes, order.shootTypeId).map(
      (r) => r.patternTemplateId,
    ),
  );
  return { ...serialized, assigneeConflicts };
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
      label: true,
      labelIsCustom: true,
      // Valeurs en base : servent de référence à la tolérance rétro-compat
      // des champs numériques (cf. validateFieldValues).
      fields: true,
      type: {
        select: { hasPlanning: true, fieldSchema: true, name: true, labelTemplate: true },
      },
    },
  });
  if (!entity) throw new NotFoundError("Fiche");

  const data: Record<string, unknown> = {};
  if (patch.label !== undefined) {
    const label = typeof patch.label === "string" ? patch.label.trim() : "";
    if (!label) throw new ValidationError("Le libellé ne peut pas être vide");
    if (label.length > MAX_ENTITY_LABEL) {
      throw new ValidationError(`Libellé trop long (max ${MAX_ENTITY_LABEL} caractères)`);
    }
    data.label = label;
    // Verrou seulement sur un VRAI changement : le formulaire renvoie le
    // libellé avec les champs à chaque enregistrement, ce qui tuerait
    // l'automatisation dès la première sauvegarde.
    if (label !== entity.label) data.labelIsCustom = true;
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
      {
        requireRequired: true,
        allowUnknownKeys: true,
        previousValues: safeJSON<Record<string, string>>(entity.fields, {}),
      },
    );
    if (err) throw new ValidationError(err);
    data.fields = JSON.stringify(patch.fields);
    // Le libellé suit les champs, sauf s'il a été personnalisé (avant ou à
    // l'instant même, ci-dessus).
    const renamedNow = data.labelIsCustom === true;
    if (!renamedNow && !entity.labelIsCustom && hasLabelTemplate(entity.type)) {
      const next = resolveEntityLabel(entity.type, patch.fields);
      if (next !== entity.label) data.label = next;
    }
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
 * Refuse la validation si le modèle ne déclenche aucune vidéo, et — quand la
 * commande porte un compte — si une de ses recettes n'y est pas active.
 *
 * ATTENTION en relisant : depuis que le compte se choisit au placement, la
 * plupart des commandes n'en ont PAS, et la seconde moitié de cette fonction
 * sort par le haut sans rien vérifier. Ce n'est pas un oubli : le contrôle
 * « recette active sur ce compte » a DÉMÉNAGÉ dans `assignSlotAccount`, au
 * moment où le compte est enfin connu. Ne pas le croire mort, et ne pas le
 * dupliquer ici.
 */
async function assertOrderIsInstantiable(orderId: string): Promise<void> {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      accountId: true,
      account: { select: { handle: true } },
      shootTypeId: true,
      shootType: { select: { label: true, videosDecidedLater: true } },
      orderTemplate: {
        select: {
          name: true,
          recipes: {
            select: {
              shootTypeId: true,
              patternTemplate: { select: { id: true, label: true, clientLabel: true } },
            },
            orderBy: { position: "asc" },
          },
        },
      },
    },
  });

  // Seules les vidéos du type de tournage retenu comptent.
  const applicable = recipesForShootType(order.orderTemplate.recipes, order.shootTypeId);

  // Zéro vidéo déclenchée : instantiateOrderSlots ferait zéro tour de boucle et
  // retournerait { createdSlotIds: [], failed: [] } — aucun toast, aucun échec,
  // une commande VALIDATED sans la moindre publication, et un bouton
  // « Réessayer » qui ne s'affiche même pas (0 < 0 est faux). C'était le SEUL
  // chemin totalement muet de la validation.
  //
  // SAUF si le type l'assume (`videosDecidedLater`) : pour un RPOD on ignore
  // combien de vidéos sortiront du contenu tourné, donc zéro est la bonne
  // réponse et la commande se valide sans publication. C'est précisément
  // pourquoi ce drapeau est explicite plutôt que déduit de « aucune recette
  // attachée » : une vraie erreur de configuration continue de parler.
  if (applicable.length === 0 && !order.shootType?.videosDecidedLater) {
    throw new ValidationError(
      order.shootType
        ? `Le type « ${order.shootType.label} » ne déclenche aucune vidéo — attachez-lui des vidéos dans Configuration → Modèles de commande, ou cochez « nombre décidé plus tard ».`
        : `Le modèle « ${order.orderTemplate.name} » ne déclenche aucune vidéo — ajoutez au moins une recette dans Configuration → Modèles de commande avant de valider.`,
    );
  }

  if (!order.accountId) return;

  const recipes = applicable.map((r) => r.patternTemplate);

  const active = await prisma.patternBinding.findMany({
    where: {
      accountId: order.accountId,
      isActive: true,
      patternTemplateId: { in: recipes.map((r) => r.id) },
    },
    select: { patternTemplateId: true },
  });
  const activeIds = new Set(active.map((b) => b.patternTemplateId));
  const missing = recipes.filter((r) => !activeIds.has(r.id));
  if (missing.length === 0) return;

  const labels = [...new Set(missing.map((r) => r.label))].join(", ");
  const handle = order.account?.handle ? `@${order.account.handle}` : "ce compte";
  throw new ConflictError(
    missing.length === 1
      ? `La recette « ${labels} » n'est pas active sur ${handle} — activez-la sur le compte avant de valider.`
      : `Les recettes « ${labels} » ne sont pas actives sur ${handle} — activez-les sur le compte avant de valider.`,
  );
}

/**
 * Complète les assignés manquants des fiches d'une commande, au moment de la
 * validation : entre la soumission et maintenant, l'admin a pu activer une
 * recette ou y renseigner une équipe.
 *
 * Retourne les tournages qui restent sans vidéaste — l'appelant les signale,
 * sinon la mission de tournage n'atteint personne (la worklist vidéaste lit
 * `Entity.assigneeVideasteId`).
 */
async function backfillOrderAssignees(
  orderId: string,
): Promise<{ id: string; label: string }[]> {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      accountId: true,
      shootTypeId: true,
      orderTemplate: {
        select: {
          recipes: {
            select: { patternTemplateId: true, shootTypeId: true },
            orderBy: { position: "asc" },
          },
        },
      },
      entities: {
        select: {
          id: true,
          label: true,
          assigneeVideasteId: true,
          defaultAssigneeMonteurId: true,
          defaultAssigneeCmId: true,
          type: { select: { hasPlanning: true, hasRushes: true, hasAssignees: true } },
        },
      },
    },
  });

  const recipeIds = recipesForShootType(order.orderTemplate.recipes, order.shootTypeId).map(
    (r) => r.patternTemplateId,
  );
  const unassignedShoots: { id: string; label: string }[] = [];

  for (const e of order.entities) {
    if (!e.type.hasAssignees) continue;
    const resolved = await resolveDefaultAssignees(order.accountId, recipeIds, {
      videasteId: e.assigneeVideasteId,
      monteurId: e.defaultAssigneeMonteurId,
      cmId: e.defaultAssigneeCmId,
    });
    if (
      resolved.videasteId !== e.assigneeVideasteId ||
      resolved.monteurId !== e.defaultAssigneeMonteurId ||
      resolved.cmId !== e.defaultAssigneeCmId
    ) {
      await prisma.entity.update({
        where: { id: e.id },
        data: {
          assigneeVideasteId: resolved.videasteId,
          defaultAssigneeMonteurId: resolved.monteurId,
          defaultAssigneeCmId: resolved.cmId,
        },
      });
    }
    if (isShootType(e.type) && !resolved.videasteId) {
      unassignedShoots.push({ id: e.id, label: e.label });
    }
  }
  return unassignedShoots;
}

/**
 * Validation admin : approuve les fiches en attente + VALIDATED (transition
 * protégée par CAS — un double-clic / deux onglets ne valident qu'une fois),
 * puis instancie les slots (hors tx, échecs isolés remontés — même contrat
 * que attachMissionsToEntity : l'appelant DOIT afficher `failed`).
 *
 * `requested` = nombre de vidéos demandées par le modèle. L'appelant en a
 * besoin pour ne pas confondre les deux façons de rendre `createdSlotIds: []`
 * ET `failed: []` : « tout existait déjà » (requested > 0, cas nominal d'un
 * retry) et « rien n'était demandé » (requested === 0). Le second est refusé
 * en amont par assertOrderIsInstantiable, mais une commande validée AVANT ce
 * garde-fou peut encore le produire.
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

  // Le modèle doit déclencher au moins une vidéo. Quand la commande porte un
  // compte (cas résiduel : commandes antérieures, ou création par script), les
  // recettes doivent y être actives — sinon le contrôle vit désormais au
  // placement, cf. `assertOrderIsInstantiable`.
  await assertOrderIsInstantiable(id);

  // Il n'y a plus de garde « compte manquant » ici : une commande SANS compte
  // est devenue le cas nominal — il se choisit au placement sur le calendrier.
  // L'ancienne garde refusait la validation dès qu'un type de fiche portait
  // `hasAccount`, ce qui bloquerait aujourd'hui absolument toutes les commandes.

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

  const unassignedShoots = await backfillOrderAssignees(id);
  const { createdSlotIds, failed, requested } = await instantiateOrderSlots(id, ctx);
  return { order: await getOrder(id, ctx), createdSlotIds, failed, requested, unassignedShoots };
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
      shootTypeId: true,
      orderTemplate: {
        select: {
          recipes: {
            select: {
              count: true,
              isOptional: true,
              defaultSelected: true,
              shootTypeId: true,
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
            orderBy: { position: "asc" },
          },
        },
      },
      // Ce que le négo a coché. Vide sur les commandes antérieures à la
      // migration : on retombe alors sur recipe.count (comportement d'avant).
      recipeSelections: { select: { patternTemplateId: true, count: true } },
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
  const selectionByPattern = new Map(
    order.recipeSelections.map((s) => [s.patternTemplateId, s.count]),
  );
  // LE filtre qui compte : sans lui, un négo ayant coché RVA1 verrait aussi
  // naître les vidéos des autres types du modèle.
  const applicableRecipes = recipesForShootType(order.orderTemplate.recipes, order.shootTypeId);

  const createdSlotIds: string[] = [];
  const failed: { patternTemplateId: string; label: string; error: string }[] = [];
  /// Nombre de vidéos que la commande DEMANDE, tous statuts confondus. Permet à
  /// l'appelant de distinguer « 0 créée parce que tout existait déjà » de
  /// « 0 créée parce que rien n'était demandé » — les deux rendaient un
  /// createdSlotIds vide et un failed vide, donc le même silence.
  const requested = applicableRecipes.reduce(
    (sum, r) => sum + effectiveRecipeCount(r, selectionByPattern, r.patternTemplate.id),
    0,
  );

  for (const recipe of applicableRecipes) {
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

    const wanted = effectiveRecipeCount(recipe, selectionByPattern, pt.id);
    for (let n = existingCount; n < wanted; n++) {
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

  return { createdSlotIds, failed, requested };
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

/**
 * Supprime définitivement une commande, et avec elle les publications qu'elle a
 * fait naître. Admin only.
 *
 * Pourquoi ça n'existait pas : rien ne l'interdisait — ni garde en base (aucune
 * FK Restrict ne pointe vers Order), ni refus applicatif. Il n'y avait ni
 * route, ni service, ni bouton. La seule sortie était `cancelOrder`, qui refuse
 * dès qu'une publication non terminale est liée : une commande ayant produit
 * des vidéos ne pouvait donc même pas être annulée, et restait à vie dans la
 * liste — en verrouillant au passage la suppression de son client et de son
 * modèle, tous deux en `Restrict` depuis Order.
 *
 * Ce qui part, ce qui reste :
 *  · les publications PARTENT — elles n'existaient que par la commande. Via
 *    `deleteSlot`, jamais un `deleteMany` : c'est lui qui nettoie le préfixe R2
 *    (rushs, versions, covers), qu'un delete en masse laisserait orphelin ;
 *  · les fiches RESTENT, simplement détachées. Décision déjà actée dans le
 *    schéma (`Entity.orderId` en SetNull) : un bien ou un tournage sont des
 *    données réelles, réutilisables, souvent enrichies à la main depuis ;
 *  · une publication déjà publiée BLOQUE tout — on ne réécrit pas un
 *    historique. Les autres statuts terminaux (archivée, annulée) partent.
 *
 * Tout ou rien au niveau de la commande : si une publication résiste, la
 * commande survit et l'erreur nomme les coupables. Supprimer quand même
 * délierait ces publications en silence (SetNull) et laisserait des orphelines
 * que plus rien ne rattache à leur origine.
 */
export async function deleteOrder(id: string, ctx: UserContext) {
  if (!ctx.canAdminBypass) throw new ForbiddenError("Réservé aux administrateurs");
  // Scope + 404 anti-énumération, comme toutes les transitions.
  await loadOrderForTransition(id, ctx);

  const slots = await prisma.publicationSlot.findMany({
    where: { orderId: id },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, status: true, publishedUrl: true },
  });

  const published = slots.filter((s) => s.status === "PUBLISHED" || s.publishedUrl);
  if (published.length > 0) {
    throw new ConflictError(
      published.length === 1
        ? "Une publication de cette commande est déjà publiée — on ne supprime pas un historique. Annulez la commande plutôt que de la supprimer."
        : `${published.length} publications de cette commande sont déjà publiées — on ne supprime pas un historique. Annulez la commande plutôt que de la supprimer.`,
    );
  }

  // `deleteSlot` fait sa propre transaction + son nettoyage R2 : on ne peut pas
  // l'envelopper dans une transaction commune. D'où la boucle, et la reddition
  // de comptes ci-dessous.
  const failed: { id: string; label: string; error: string }[] = [];
  for (const slot of slots) {
    try {
      await deleteSlot(slot.id, ctx);
    } catch (err) {
      failed.push({
        id: slot.id,
        label: slot.title ?? slot.id,
        error: err instanceof Error ? err.message : "Erreur inconnue",
      });
    }
  }
  if (failed.length > 0) {
    const labels = failed.map((f) => f.label).join(", ");
    throw new ConflictError(
      `${failed.length} publication(s) n'ont pas pu être supprimées (${labels}) — la commande est conservée. Réessayez : celles déjà supprimées ne le seront pas deux fois.`,
    );
  }

  // Les fiches survivent, mais pas leur demande de validation : un
  // PENDING_ADMIN/REJECTED orphelin les rendrait inutilisables pour toujours
  // (assertEntityValidated), sans plus aucune commande pour le lever. Même
  // raisonnement que `cancelOrder`.
  const blocked = await prisma.entity.findMany({
    where: { orderId: id, validationStatus: { in: ["PENDING_ADMIN", "REJECTED"] } },
    select: { id: true, validationStatus: true },
  });

  const entityCount = await prisma.entity.count({ where: { orderId: id } });

  await prisma.$transaction(async (tx) => {
    for (const e of blocked) {
      await tx.entity.update({ where: { id: e.id }, data: { validationStatus: null } });
      await logEntityActivity(tx, {
        entityId: e.id,
        actorId: ctx.actualUser.id,
        type: "UPDATED",
        payload: { validationCleared: e.validationStatus, orderId: id, reason: "order_deleted" },
      });
    }
    // Détache les slots survivants (aucun ici) et cascade OrderRecipeSelection.
    await tx.order.delete({ where: { id } });
  });

  return { deleted: true as const, slotsDeleted: slots.length, entitiesKept: entityCount };
}
