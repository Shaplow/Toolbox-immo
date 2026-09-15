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
import { Prisma } from "@prisma/client";
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
const MAX_SHOOT_TYPES = 10;
const MAX_SHOOT_TYPE_LABEL = 60;
const MAX_SHOOT_TYPE_DESCRIPTION = 300;

// ─── Types I/O ──────────────────────────────────────────────────────────────

export interface OrderTemplateInput {
  name: string;
  description?: string | null;
  position?: number;
  isArchived?: boolean;
  /** Types de fiches à remplir, dans l'ordre du formulaire client. */
  items: {
    entityTypeId: string;
    /**
     * Types de tournage qui demandent cette fiche, par leur `key` locale.
     * VIDE = tous les types la demandent — « si c'est un RPOD, pas besoin de la
     * fiche bien » se règle en décochant RPOD ici.
     */
    shootTypeKeys?: string[];
  }[];
  /**
   * Recettes instanciées à la validation (count reels chacune).
   * `isOptional` laisse le négo cocher la vidéo et ajuster sa quantité
   * dans [minCount, count] ; sinon elle est imposée.
   */
  recipes: {
    patternTemplateId: string;
    count: number;
    isOptional?: boolean;
    defaultSelected?: boolean;
    minCount?: number;
    /**
     * Type de tournage auquel cette vidéo appartient, désigné par la `key` d'une
     * entrée de `shootTypes`. Absent = vidéo COMMUNE à tous les types.
     */
    shootTypeKey?: string | null;
  }[];
  /**
   * Types de tournage proposés par ce modèle (RVA, RPOD…). Chacun commande
   * quelles vidéos sont cochables.
   *
   * `id` présent = type EXISTANT à conserver. C'est essentiel : contrairement
   * aux items et aux recettes, les types ne peuvent pas être supprimés puis
   * recréés à chaque enregistrement — les commandes passées les référencent
   * (`Order.shootTypeId`), et elles perdraient leur type à la première
   * modification du modèle.
   *
   * `key` est l'identifiant LOCAL du formulaire : les recettes y réfèrent, ce
   * qui permet de rattacher une vidéo à un type qui n'existe pas encore en base.
   */
  shootTypes?: {
    id?: string;
    key: string;
    label: string;
    description?: string | null;
    videosDecidedLater?: boolean;
  }[];
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
      shootTypes: { select: { shootTypeId: true } },
    },
  },
  recipes: {
    select: {
      id: true,
      patternTemplateId: true,
      count: true,
      isOptional: true,
      defaultSelected: true,
      minCount: true,
      shootTypeId: true,
      patternTemplate: {
        select: {
          id: true,
          label: true,
          clientLabel: true,
          clientDescription: true,
          source: true,
          isArchived: true,
        },
      },
    },
    orderBy: { position: "asc" as const },
  },
  shootTypes: {
    select: {
      id: true,
      label: true,
      description: true,
      videosDecidedLater: true,
      position: true,
    },
    orderBy: { position: "asc" as const },
  },
  accesses: {
    select: { clientId: true, client: { select: { id: true, name: true } } },
  },
  _count: { select: { orders: true } },
};

export type OrderTemplateRecord = Awaited<ReturnType<typeof listOrderTemplates>>[number];

// ─── Parsing du corps HTTP ──────────────────────────────────────────────────

/**
 * Corps JSON brut → `OrderTemplateInput`.
 *
 * Ici et pas dans les routes : POST et PATCH le dupliquaient à l'identique, et
 * c'est exactement le terrain sur lequel deux routes divergent au premier champ
 * ajouté (cf. l'en-tête de `patternTemplateInput`, écrit après deux divergences
 * réelles). La VALIDATION reste dans `validateInput` — ceci ne fait que typer.
 */
export function parseOrderTemplateInput(body: Record<string, unknown>): OrderTemplateInput {
  return {
    name: typeof body.name === "string" ? body.name : "",
    description: typeof body.description === "string" ? body.description : null,
    position: typeof body.position === "number" ? body.position : undefined,
    isArchived: body.isArchived === true,
    items: Array.isArray(body.items)
      ? (body.items as { entityTypeId?: unknown; shootTypeKeys?: unknown }[]).map((i) => ({
          entityTypeId: typeof i?.entityTypeId === "string" ? i.entityTypeId : "",
          // Absent ou vide = fiche demandée par tous les types de tournage.
          shootTypeKeys: Array.isArray(i?.shootTypeKeys)
            ? (i.shootTypeKeys as unknown[]).filter((k): k is string => typeof k === "string" && !!k)
            : [],
        }))
      : [],
    recipes: Array.isArray(body.recipes)
      ? (
          body.recipes as {
            patternTemplateId?: unknown;
            count?: unknown;
            isOptional?: unknown;
            defaultSelected?: unknown;
            minCount?: unknown;
            shootTypeKey?: unknown;
          }[]
        ).map((r) => ({
          patternTemplateId: typeof r?.patternTemplateId === "string" ? r.patternTemplateId : "",
          count: typeof r?.count === "number" ? r.count : NaN,
          isOptional: r?.isOptional === true,
          // Une optionnelle est pré-cochée sauf refus explicite : c'est le
          // comportement le moins surprenant quand l'admin vient d'en créer une.
          defaultSelected: r?.defaultSelected !== false,
          minCount: typeof r?.minCount === "number" ? r.minCount : 0,
          // Absent = vidéo commune à tous les types de tournage.
          shootTypeKey:
            typeof r?.shootTypeKey === "string" && r.shootTypeKey ? r.shootTypeKey : null,
        }))
      : [],
    shootTypes: Array.isArray(body.shootTypes)
      ? (
          body.shootTypes as {
            id?: unknown;
            key?: unknown;
            label?: unknown;
            description?: unknown;
            videosDecidedLater?: unknown;
          }[]
        ).map((t) => ({
          // `id` présent = type EXISTANT : le service le met à jour au lieu de
          // le recréer, pour que les commandes passées gardent leur type.
          id: typeof t?.id === "string" && t.id ? t.id : undefined,
          key: typeof t?.key === "string" ? t.key : "",
          label: typeof t?.label === "string" ? t.label : "",
          description: typeof t?.description === "string" ? t.description : null,
          videosDecidedLater: t?.videosDecidedLater === true,
        }))
      : [],
    clientIds: Array.isArray(body.clientIds)
      ? (body.clientIds as unknown[]).filter((c): c is string => typeof c === "string")
      : [],
  };
}

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
  const rawItems = (input.items ?? []).filter((i) => i?.entityTypeId);
  const itemTypeIds = rawItems.map((i) => i.entityTypeId);
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

  // Types de tournage — libellés obligatoires, clés locales uniques.
  const shootTypes = (input.shootTypes ?? []).filter((t) => t && typeof t.key === "string");
  if (shootTypes.length > MAX_SHOOT_TYPES) {
    throw new ValidationError(`Trop de types de tournage (max ${MAX_SHOOT_TYPES})`);
  }
  const cleanShootTypes = shootTypes.map((t) => {
    const label = t.label?.trim();
    if (!label) throw new ValidationError("Chaque type de tournage doit avoir un libellé");
    if (label.length > MAX_SHOOT_TYPE_LABEL) {
      throw new ValidationError(`Libellé de type trop long (max ${MAX_SHOOT_TYPE_LABEL})`);
    }
    return {
      id: typeof t.id === "string" && t.id ? t.id : null,
      key: t.key,
      label,
      description:
        typeof t.description === "string" && t.description.trim()
          ? t.description.trim().slice(0, MAX_SHOOT_TYPE_DESCRIPTION)
          : null,
      videosDecidedLater: t.videosDecidedLater === true,
    };
  });
  const shootKeys = cleanShootTypes.map((t) => t.key);
  if (new Set(shootKeys).size !== shootKeys.length) {
    throw new ValidationError("Deux types de tournage portent la même clé");
  }
  const shootLabels = cleanShootTypes.map((t) => t.label.toLowerCase());
  if (new Set(shootLabels).size !== shootLabels.length) {
    throw new ValidationError("Deux types de tournage portent le même nom");
  }

  // Rattachement des fiches aux types de tournage.
  const knownShootKeys = new Set(shootKeys);
  const cleanItems = rawItems.map((i) => {
    const keys = [...new Set(i.shootTypeKeys ?? [])];
    for (const k of keys) {
      if (!knownShootKeys.has(k)) {
        throw new ValidationError("Une fiche référence un type de tournage inconnu");
      }
    }
    // Normalisation VITALE : « tous les types cochés » et « aucune restriction »
    // disent la même chose, et deux encodages d'une même vérité divergent au
    // premier type ajouté — la fiche s'en trouverait silencieusement exclue du
    // nouveau type alors que l'admin croit l'avoir mise partout.
    const restricted = keys.length > 0 && keys.length < shootKeys.length;
    return { entityTypeId: i.entityTypeId, shootTypeKeys: restricted ? keys : [] };
  });
  // Un type de tournage qui ne demande AUCUNE fiche produirait une commande sans
  // la moindre entité : rien à quoi rattacher les publications, et toute recette
  // exigeant une fiche échouerait le jour de la validation. C'est une erreur de
  // configuration, elle doit parler maintenant.
  for (const t of cleanShootTypes) {
    const demanded = cleanItems.some(
      (i) => i.shootTypeKeys.length === 0 || i.shootTypeKeys.includes(t.key),
    );
    if (!demanded) {
      throw new ValidationError(`Le type de tournage « ${t.label} » ne demande aucune fiche`);
    }
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
    // `minCount` borne le bas de la fourchette laissée au négo. Au-dessus de
    // `count` elle serait vide, et le formulaire deviendrait insatisfiable.
    const minCount = r.minCount ?? 0;
    if (!Number.isInteger(minCount) || minCount < 0 || minCount > r.count) {
      throw new ValidationError(`Quantité minimale invalide (0 à ${r.count})`);
    }
  }
  const knownKeys = new Set(shootKeys);
  for (const r of recipes) {
    if (r.shootTypeKey && !knownKeys.has(r.shootTypeKey)) {
      throw new ValidationError("Une vidéo référence un type de tournage inconnu");
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
    items: cleanItems,
    recipes,
    shootTypes: cleanShootTypes,
    clientIds,
  };
}

/**
 * Écrit les types de tournage d'un modèle en PRÉSERVANT les ids existants, et
 * rend la table `key du formulaire → id en base` dont les recettes ont besoin.
 *
 * Pourquoi pas un deleteMany + createMany comme pour les items et les recettes :
 * les commandes passées référencent ces types (`Order.shootTypeId`). Les
 * recréer à chaque enregistrement leur ferait perdre leur type — silencieusement,
 * puisque la clé étrangère est en SetNull.
 */
async function writeShootTypes(
  tx: Prisma.TransactionClient,
  orderTemplateId: string,
  types: { id: string | null; key: string; label: string; description: string | null; videosDecidedLater: boolean }[],
): Promise<Map<string, string>> {
  const keptIds = types.map((t) => t.id).filter((id): id is string => Boolean(id));
  // Retirés du formulaire : leurs vidéos redeviennent communes (SetNull), mais
  // les recettes sont réécrites juste après de toute façon.
  await tx.orderTemplateShootType.deleteMany({
    where: { orderTemplateId, ...(keptIds.length ? { id: { notIn: keptIds } } : {}) },
  });

  const keyToId = new Map<string, string>();
  for (const [i, t] of types.entries()) {
    const data = {
      label: t.label,
      description: t.description,
      videosDecidedLater: t.videosDecidedLater,
      position: i,
    };
    if (t.id) {
      // `updateMany` et non `update` : borne au modèle courant, donc un id
      // d'un AUTRE modèle glissé dans le payload ne peut rien réécrire.
      const res = await tx.orderTemplateShootType.updateMany({
        where: { id: t.id, orderTemplateId },
        data,
      });
      if (res.count === 1) {
        keyToId.set(t.key, t.id);
        continue;
      }
    }
    const created = await tx.orderTemplateShootType.create({
      data: { ...data, orderTemplateId },
      select: { id: true },
    });
    keyToId.set(t.key, created.id);
  }
  return keyToId;
}

/**
 * Écrit les items ET leur rattachement aux types de tournage.
 *
 * Un `create` par item et non un `createMany` : la jonction a besoin de l'id de
 * l'item, que `createMany` ne rend pas. Dix items au maximum (`MAX_ITEMS`),
 * dans la transaction existante — le coût est nul, et l'écriture imbriquée
 * garantit qu'un item ne peut pas exister sans ses liaisons.
 *
 * À appeler APRÈS `writeShootTypes` : les clés locales n'ont d'id qu'ensuite.
 */
async function writeItems(
  tx: Prisma.TransactionClient,
  orderTemplateId: string,
  items: { entityTypeId: string; shootTypeKeys: string[] }[],
  keyToId: Map<string, string>,
): Promise<void> {
  for (const [i, item] of items.entries()) {
    const shootTypeIds = item.shootTypeKeys
      .map((k) => keyToId.get(k))
      .filter((id): id is string => Boolean(id));
    await tx.orderTemplateItem.create({
      data: {
        orderTemplateId,
        entityTypeId: item.entityTypeId,
        position: i,
        ...(shootTypeIds.length > 0
          ? { shootTypes: { create: shootTypeIds.map((shootTypeId) => ({ shootTypeId })) } }
          : {}),
      },
    });
  }
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
    // Les types de tournage EN PREMIER : les items comme les recettes y réfèrent
    // par leur id, qui n'existe qu'une fois les types écrits.
    const keyToId = await writeShootTypes(tx, created.id, clean.shootTypes);
    await writeItems(tx, created.id, clean.items, keyToId);
    if (clean.recipes.length > 0) {
      await tx.orderTemplateRecipe.createMany({
        data: clean.recipes.map((r, i) => ({
          orderTemplateId: created.id,
          patternTemplateId: r.patternTemplateId,
          count: r.count,
          isOptional: r.isOptional ?? false,
          defaultSelected: r.defaultSelected ?? true,
          minCount: r.minCount ?? 0,
          shootTypeId: r.shootTypeKey ? (keyToId.get(r.shootTypeKey) ?? null) : null,
          position: i,
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
    await tx.orderTemplateRecipe.deleteMany({ where: { orderTemplateId: id } });
    // Les types de tournage AVANT les items (leurs liaisons en dépendent) — les
    // items sont réécrits wholesale, la jonction part avec eux en Cascade.
    const keyToId = await writeShootTypes(tx, id, clean.shootTypes);
    await tx.orderTemplateItem.deleteMany({ where: { orderTemplateId: id } });
    await writeItems(tx, id, clean.items, keyToId);
    if (clean.recipes.length > 0) {
      await tx.orderTemplateRecipe.createMany({
        data: clean.recipes.map((r, i) => ({
          orderTemplateId: id,
          patternTemplateId: r.patternTemplateId,
          count: r.count,
          isOptional: r.isOptional ?? false,
          defaultSelected: r.defaultSelected ?? true,
          minCount: r.minCount ?? 0,
          shootTypeId: r.shootTypeKey ? (keyToId.get(r.shootTypeKey) ?? null) : null,
          position: i,
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
