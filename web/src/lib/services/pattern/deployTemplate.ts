/**
 * deployTemplateToAccounts — Sprint C.
 *
 * Crée N PatternBinding pour appliquer une PatternTemplate (recette globale)
 * à plusieurs comptes Instagram en une seule opération.
 *
 * Cas d'usage : l'admin a configuré une recette « Reels Lola » sur 1 compte
 * et veut l'appliquer à 5 nouveaux comptes avec le même planning par défaut.
 *
 * Contraintes :
 *  - ADMIN uniquement.
 *  - La recette ne doit pas être archivée.
 *  - Les comptes qui ont déjà un binding actif sur cette recette sont skip
 *    (silencieusement). Le retour précise le nombre créés vs skipés.
 *  - Le binding par défaut a `isActive: true`.
 */
import { PUBLISH_TIME_RE } from "@/lib/publications/patternEnums";
import { prisma } from "@/lib/prisma";
import type { UserContext } from "@/lib/userContext";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/services/_runtime/errors";
import { assertAssigneeRole } from "@/lib/services/slot/slotService";

export const DEPLOY_MIN_ACCOUNTS = 1;
export const DEPLOY_MAX_ACCOUNTS = 50;

export interface DeployTemplateInput {
  patternTemplateId: string;
  accountIds: string[];
  publishTime: string;
  dayOfWeek: number[];
  defaultAssigneeMonteurId?: string | null;
  defaultAssigneeCmId?: string | null;
  defaultAssigneeVideasteId?: string | null;
}

export interface DeployTemplateResult {
  createdCount: number;
  skippedCount: number;
  bindingIds: string[];
}

/**
 * Les gardes qui ne dépendent PAS de la recette : droits, comptes, planning,
 * rôles des assignées par défaut.
 *
 * Extraites pour que le déploiement multi-recettes les passe UNE fois : les
 * rejouer par recette multiplierait les requêtes `assertAssigneeRole`, et
 * surtout ferait échouer N fois de suite la même cause — un planning invalide
 * n'est pas un échec « de la recette 3 ».
 */
async function assertCommonDeployInput(
  input: Omit<DeployTemplateInput, "patternTemplateId">,
  ctx: UserContext,
): Promise<void> {
  if (!ctx.canAdminBypass) {
    throw new ForbiddenError("Réservé aux administrateurs");
  }
  if (!Array.isArray(input.accountIds) || input.accountIds.length === 0) {
    throw new ValidationError("accountIds requis (au moins 1)");
  }
  if (
    input.accountIds.length < DEPLOY_MIN_ACCOUNTS ||
    input.accountIds.length > DEPLOY_MAX_ACCOUNTS
  ) {
    throw new ValidationError(
      `Entre ${DEPLOY_MIN_ACCOUNTS} et ${DEPLOY_MAX_ACCOUNTS} comptes par déploiement`,
    );
  }
  if (!PUBLISH_TIME_RE.test(input.publishTime)) {
    throw new ValidationError("publishTime doit être HH:MM");
  }
  if (!Array.isArray(input.dayOfWeek)) {
    throw new ValidationError("dayOfWeek doit être un tableau");
  }
  for (const d of input.dayOfWeek) {
    if (!Number.isInteger(d) || d < 1 || d > 7) {
      throw new ValidationError("dayOfWeek : entiers 1-7 attendus");
    }
  }

  // Bug C.3 — Validation des rôles des assignees par défaut (parité avec
  // createSlot). Évite des bindings incohérents qui seront ensuite refusés
  // au patchSlot/createSlot.
  if (input.defaultAssigneeMonteurId) {
    await assertAssigneeRole(
      input.defaultAssigneeMonteurId,
      ["MONTEUR", "ADMIN"],
      "defaultAssigneeMonteur",
    );
  }
  if (input.defaultAssigneeCmId) {
    await assertAssigneeRole(
      input.defaultAssigneeCmId,
      ["CM", "ADMIN"],
      "defaultAssigneeCm",
    );
  }
  if (input.defaultAssigneeVideasteId) {
    await assertAssigneeRole(
      input.defaultAssigneeVideasteId,
      ["VIDEASTE", "ADMIN"],
      "defaultAssigneeVideaste",
    );
  }
}

export async function deployTemplateToAccounts(
  input: DeployTemplateInput,
  ctx: UserContext,
): Promise<DeployTemplateResult> {
  await assertCommonDeployInput(input, ctx);
  if (!input.patternTemplateId) {
    throw new ValidationError("patternTemplateId requis");
  }
  return deployOneValidated(input.patternTemplateId, input);
}

/** Le cœur, APRÈS `assertCommonDeployInput` — une recette, N comptes. */
async function deployOneValidated(
  patternTemplateId: string,
  input: Omit<DeployTemplateInput, "patternTemplateId">,
): Promise<DeployTemplateResult> {
  const template = await prisma.patternTemplate.findUnique({
    where: { id: patternTemplateId },
    select: { id: true, isArchived: true },
  });
  if (!template) {
    throw new NotFoundError("Recette");
  }
  if (template.isArchived) {
    throw new ValidationError(
      "Recette archivée — impossible de déployer.",
    );
  }

  // Vérifie quels comptes ont déjà un binding actif sur cette recette.
  const existingBindings = await prisma.patternBinding.findMany({
    where: {
      patternTemplateId,
      accountId: { in: input.accountIds },
    },
    select: { accountId: true },
  });
  const alreadyLinked = new Set(existingBindings.map((b) => b.accountId));
  const toCreate = input.accountIds.filter((id) => !alreadyLinked.has(id));

  if (toCreate.length === 0) {
    return {
      createdCount: 0,
      skippedCount: input.accountIds.length,
      bindingIds: [],
    };
  }

  // Vérification existence des comptes cibles (pas de FK violation cryptique).
  const accounts = await prisma.instagramAccount.findMany({
    where: { id: { in: toCreate } },
    select: { id: true },
  });
  const validAccountIds = new Set(accounts.map((a) => a.id));
  const finalCreate = toCreate.filter((id) => validAccountIds.has(id));
  const skippedInvalid = toCreate.length - finalCreate.length;

  if (finalCreate.length === 0) {
    return {
      createdCount: 0,
      skippedCount: alreadyLinked.size + skippedInvalid,
      bindingIds: [],
    };
  }

  // Transaction : N create()  (createMany ne renvoie pas les ids).
  const created = await prisma.$transaction(async (tx) => {
    const ids: string[] = [];
    for (const accountId of finalCreate) {
      const binding = await tx.patternBinding.create({
        data: {
          accountId,
          patternTemplateId,
          dayOfWeek: input.dayOfWeek,
          publishTime: input.publishTime,
          isActive: true,
          defaultAssigneeMonteurId: input.defaultAssigneeMonteurId ?? null,
          defaultAssigneeCmId: input.defaultAssigneeCmId ?? null,
          defaultAssigneeVideasteId: input.defaultAssigneeVideasteId ?? null,
        },
        select: { id: true },
      });
      ids.push(binding.id);
    }
    return ids;
  });

  return {
    createdCount: created.length,
    skippedCount: alreadyLinked.size + skippedInvalid,
    bindingIds: created,
  };
}

/** Une sélection de catalogue, pas un import en masse — même ordre de grandeur que les comptes. */
export const DEPLOY_MAX_TEMPLATES = 50;

export interface DeployTemplatesInput extends Omit<DeployTemplateInput, "patternTemplateId"> {
  patternTemplateIds: string[];
}

export interface DeployTemplatesResult {
  ok: { patternTemplateId: string; createdCount: number; skippedCount: number }[];
  failed: { patternTemplateId: string; error: string }[];
  createdCount: number;
  skippedCount: number;
}

/**
 * Déploie N recettes sur N comptes — « appliquer à des comptes » depuis une
 * sélection du catalogue, au lieu de rouvrir la modale recette par recette.
 *
 * Résultats PARTIELS (doctrine du repo) : une recette archivée ou introuvable
 * au milieu de la sélection ne doit pas annuler les autres. Chaque recette est
 * sa propre transaction ; la boucle est séquentielle parce que chacune ouvre
 * déjà une transaction Prisma (N transactions concurrentes = pool épuisé).
 */
export async function deployTemplatesToAccounts(
  input: DeployTemplatesInput,
  ctx: UserContext,
): Promise<DeployTemplatesResult> {
  if (!ctx.canAdminBypass) {
    throw new ForbiddenError("Réservé aux administrateurs");
  }
  const ids = [...new Set((input.patternTemplateIds ?? []).filter(Boolean))];
  if (ids.length === 0) {
    throw new ValidationError("patternTemplateIds requis (au moins 1)");
  }
  if (ids.length > DEPLOY_MAX_TEMPLATES) {
    throw new ValidationError(`${DEPLOY_MAX_TEMPLATES} recettes maximum par déploiement`);
  }

  // Les gardes communes d'abord, et une seule fois : un planning invalide doit
  // remonter tel quel, pas se répéter N fois dans `failed`.
  await assertCommonDeployInput(input, ctx);

  const result: DeployTemplatesResult = {
    ok: [],
    failed: [],
    createdCount: 0,
    skippedCount: 0,
  };

  for (const patternTemplateId of ids) {
    try {
      const one = await deployOneValidated(patternTemplateId, input);
      result.ok.push({
        patternTemplateId,
        createdCount: one.createdCount,
        skippedCount: one.skippedCount,
      });
      result.createdCount += one.createdCount;
      result.skippedCount += one.skippedCount;
    } catch (err) {
      // Ce qui reste ne concerne QUE cette recette (introuvable, archivée) :
      // ça n'annule pas les autres, c'est tout l'objet des résultats partiels.
      result.failed.push({
        patternTemplateId,
        error: err instanceof Error ? err.message : "Erreur inconnue",
      });
    }
  }

  return result;
}
