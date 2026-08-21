/**
 * Service OrderTemplate — CRUD des modèles de bons de commande (ADMIN).
 *
 * Un OrderTemplate définit la composition d'une commande :
 *  - `items`   : quels types de fiches l'agence remplit (ordonnés) ;
 *  - `recipes` : quelles recettes (PatternTemplate) sont instanciées à la
 *    validation, et combien de reels chacune (`count`) ;
 *  - `accesses`: allowlist des clients autorisés (même philosophie que
 *    TemplateAccess — rien n'est visible par défaut).
 *
 * Convention repo : throw ServiceError → mapServiceError dans la route.
 * Le gating admin vit dans les routes (requireAdmin) — pas de ctx ici.
 */

import { prisma } from "@/lib/prisma";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/services/_runtime/errors";

const MAX_NAME = 100;
const MAX_DESCRIPTION = 2000;
const MAX_ITEMS = 10;
const MAX_RECIPES = 20;
const MAX_COUNT = 20;

// ─── Types I/O ──────────────────────────────────────────────────────────────

export interface OrderTemplateInput {
  name: string;
  description?: string | null;
  position?: number;
  isArchived?: boolean;
  /** Types de fiches à remplir, dans l'ordre du formulaire client. */
  items: { entityTypeId: string }[];
  /** Recettes instanciées à la validation (count reels chacune). */
  recipes: { patternTemplateId: string; count: number }[];
  /** Allowlist clients. */
  clientIds: string[];
}

const orderTemplateSelect = {
  id: true,
  name: true,
  description: true,
  isArchived: true,
  position: true,
  createdAt: true,
  updatedAt: true,
  items: {
    orderBy: { position: "asc" as const },
    select: {
      id: true,
      entityTypeId: true,
      position: true,
      entityType: { select: { id: true, name: true, icon: true, hasPlanning: true, hasRushes: true } },
    },
  },
  recipes: {
    select: {
      id: true,
      patternTemplateId: true,
      count: true,
      patternTemplate: { select: { id: true, label: true, source: true, isArchived: true } },
    },
  },
  accesses: {
    select: { clientId: true, client: { select: { id: true, name: true } } },
  },
  _count: { select: { orders: true } },
};

export type OrderTemplateRecord = Awaited<ReturnType<typeof listOrderTemplates>>[number];

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Normalise + valide un input de modèle. Retourne l'input propre ou throw
 * ValidationError. Vérifie l'existence réelle des références (types, recettes
 * non archivées, clients).
 */
async function validateInput(input: OrderTemplateInput) {
  const name = input.name?.trim();
  if (!name) throw new ValidationError("Un nom est requis");
  if (name.length > MAX_NAME) {
    throw new ValidationError(`Nom trop long (max ${MAX_NAME} caractères)`);
  }
  const description =
    typeof input.description === "string" && input.description.trim()
      ? input.description.trim().slice(0, MAX_DESCRIPTION)
      : null;

  // Items — ≥1, types existants, dédupliqués (2 fiches du même type dans une
  // même commande seraient ambiguës pour le câblage relatedEntityId).
  const itemTypeIds = (input.items ?? []).map((i) => i?.entityTypeId).filter(Boolean);
  if (itemTypeIds.length === 0) {
    throw new ValidationError("Au moins un type de fiche est requis");
  }
  if (itemTypeIds.length > MAX_ITEMS) {
    throw new ValidationError(`Trop de types de fiches (max ${MAX_ITEMS})`);
  }
  if (new Set(itemTypeIds).size !== itemTypeIds.length) {
    throw new ValidationError("Chaque type de fiche ne peut apparaître qu'une fois");
  }
  const types = await prisma.entityType.findMany({
    where: { id: { in: itemTypeIds } },
    select: { id: true },
  });
  if (types.length !== itemTypeIds.length) {
    throw new ValidationError("Un des types de fiches n'existe pas");
  }

  // Recettes — existantes, non archivées, count borné.
  const recipes = (input.recipes ?? []).filter((r) => r?.patternTemplateId);
  if (recipes.length > MAX_RECIPES) {
    throw new ValidationError(`Trop de recettes (max ${MAX_RECIPES})`);
  }
  for (const r of recipes) {
    if (!Number.isInteger(r.count) || r.count < 1 || r.count > MAX_COUNT) {
      throw new ValidationError(`Nombre de vidéos invalide (1 à ${MAX_COUNT})`);
    }
  }
  const recipeIds = recipes.map((r) => r.patternTemplateId);
  if (new Set(recipeIds).size !== recipeIds.length) {
    throw new ValidationError("Chaque recette ne peut apparaître qu'une fois");
  }
  if (recipeIds.length > 0) {
    const found = await prisma.patternTemplate.findMany({
      where: { id: { in: recipeIds } },
      select: { id: true, isArchived: true, label: true },
    });
    if (found.length !== recipeIds.length) {
      throw new ValidationError("Une des recettes n'existe pas");
    }
    const archived = found.find((t) => t.isArchived);
    if (archived) {
      throw new ValidationError(`La recette « ${archived.label} » est archivée`);
    }
  }

  // Clients — existants, dédupliqués.
  const clientIds = [...new Set((input.clientIds ?? []).filter(Boolean))];
  if (clientIds.length > 0) {
    const clients = await prisma.client.findMany({
      where: { id: { in: clientIds } },
      select: { id: true },
    });
    if (clients.length !== clientIds.length) {
      throw new ValidationError("Un des clients n'existe pas");
    }
  }

  return {
    name,
    description,
    // undefined = non fourni : défaut 0 à la création, position PRÉSERVÉE à
    // l'update (le drawer n'envoie pas position — sinon elle serait écrasée).
    position:
      typeof input.position === "number" && Number.isFinite(input.position)
        ? input.position
        : undefined,
    isArchived: input.isArchived === true,
    itemTypeIds,
    recipes,
    clientIds,
  };
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export async function listOrderTemplates(opts: { includeArchived?: boolean } = {}) {
  return prisma.orderTemplate.findMany({
    where: opts.includeArchived ? {} : { isArchived: false },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: orderTemplateSelect,
  });
}

export async function getOrderTemplate(id: string) {
  const template = await prisma.orderTemplate.findUnique({
    where: { id },
    select: orderTemplateSelect,
  });
  if (!template) throw new NotFoundError("Modèle de commande");
  return template;
}

export async function createOrderTemplate(input: OrderTemplateInput) {
  const clean = await validateInput(input);
  return prisma.$transaction(async (tx) => {
    const created = await tx.orderTemplate.create({
      data: {
        name: clean.name,
        description: clean.description,
        position: clean.position ?? 0,
        isArchived: clean.isArchived,
      },
      select: { id: true },
    });
    await tx.orderTemplateItem.createMany({
      data: clean.itemTypeIds.map((entityTypeId, i) => ({
        orderTemplateId: created.id,
        entityTypeId,
        position: i,
      })),
    });
    if (clean.recipes.length > 0) {
      await tx.orderTemplateRecipe.createMany({
        data: clean.recipes.map((r) => ({
          orderTemplateId: created.id,
          patternTemplateId: r.patternTemplateId,
          count: r.count,
        })),
      });
    }
    if (clean.clientIds.length > 0) {
      await tx.orderTemplateAccess.createMany({
        data: clean.clientIds.map((clientId) => ({
          orderTemplateId: created.id,
          clientId,
        })),
      });
    }
    return tx.orderTemplate.findUniqueOrThrow({
      where: { id: created.id },
      select: orderTemplateSelect,
    });
  });
}

/**
 * Remplacement wholesale des items/recipes/accesses. Attention au cycle de
 * vie : les commandes existantes ne référencent que l'id du template, mais
 * l'instanciation (validateOrder) relit la composition COURANTE — éditer un
 * modèle avec des commandes SUBMITTED change ce qui sera instancié (pas de
 * snapshot à la soumission, tradeoff v1 assumé).
 */
export async function updateOrderTemplate(id: string, input: OrderTemplateInput) {
  const existing = await prisma.orderTemplate.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new NotFoundError("Modèle de commande");
  const clean = await validateInput(input);
  return prisma.$transaction(async (tx) => {
    await tx.orderTemplate.update({
      where: { id },
      data: {
        name: clean.name,
        description: clean.description,
        ...(clean.position !== undefined ? { position: clean.position } : {}),
        isArchived: clean.isArchived,
      },
    });
    await tx.orderTemplateItem.deleteMany({ where: { orderTemplateId: id } });
    await tx.orderTemplateItem.createMany({
      data: clean.itemTypeIds.map((entityTypeId, i) => ({
        orderTemplateId: id,
        entityTypeId,
        position: i,
      })),
    });
    await tx.orderTemplateRecipe.deleteMany({ where: { orderTemplateId: id } });
    if (clean.recipes.length > 0) {
      await tx.orderTemplateRecipe.createMany({
        data: clean.recipes.map((r) => ({
          orderTemplateId: id,
          patternTemplateId: r.patternTemplateId,
          count: r.count,
        })),
      });
    }
    await tx.orderTemplateAccess.deleteMany({ where: { orderTemplateId: id } });
    if (clean.clientIds.length > 0) {
      await tx.orderTemplateAccess.createMany({
        data: clean.clientIds.map((clientId) => ({ orderTemplateId: id, clientId })),
      });
    }
    return tx.orderTemplate.findUniqueOrThrow({
      where: { id },
      select: orderTemplateSelect,
    });
  });
}

/** Refuse (409) si des commandes référencent le modèle — archiver à la place. */
export async function deleteOrderTemplate(id: string) {
  const existing = await prisma.orderTemplate.findUnique({
    where: { id },
    select: { id: true, _count: { select: { orders: true } } },
  });
  if (!existing) throw new NotFoundError("Modèle de commande");
  if (existing._count.orders > 0) {
    throw new ConflictError(
      `${existing._count.orders} commande(s) utilisent ce modèle — archivez-le plutôt`,
    );
  }
  await prisma.orderTemplate.delete({ where: { id } });
}
