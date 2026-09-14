/**
 * autoActivateForAccount — activation automatique des recettes sur un compte.
 *
 * Répond à : « à chaque nouveau compte je dois penser à activer certains types
 * de vidéos, je vais sans doute oublier ». Une recette déclare les CLIENTS dont
 * les comptes la reçoivent d'office (`PatternTemplateAutoActivation`) ; à la
 * création d'un compte, ou à son rattachement à un client, les bindings
 * manquants sont créés sans intervention.
 *
 * Ce module ne réécrit AUCUN mécanisme de déploiement : il boucle sur
 * `deployTemplateToAccounts`, qui apporte déjà le skip-si-déjà-lié, le refus
 * des recettes archivées et la vérification d'existence du compte. Le coût est
 * N petites transactions au lieu d'une — négligeable à cette échelle, et c'est
 * le prix de la non-duplication.
 *
 * Résultats PARTIELS (`{ ok, failed }`), convention du repo : une recette
 * archivée ne doit pas empêcher les autres de s'activer.
 */

import { prisma } from "@/lib/prisma";
import type { UserContext } from "@/lib/userContext";
import { deployTemplateToAccounts, DEPLOY_MAX_ACCOUNTS } from "./deployTemplate";

export interface AutoActivationGap {
  patternTemplateId: string;
  label: string;
}

export interface AutoActivationResult {
  ok: { patternTemplateId: string; label: string }[];
  failed: { patternTemplateId: string; label: string; error: string }[];
}

/**
 * Recettes attendues sur ce compte (via le client qui le porte) et qui n'y ont
 * aucun binding. C'est ce que la fiche compte signale, et ce que le bouton de
 * rattrapage applique.
 *
 * Un compte sans client ne peut rien attendre : retour vide, zéro requête.
 */
export async function listMissingAutoActivations(
  accountId: string,
): Promise<AutoActivationGap[]> {
  const account = await prisma.instagramAccount.findUnique({
    where: { id: accountId },
    select: { clientId: true },
  });
  if (!account?.clientId) return [];

  const expected = await prisma.patternTemplateAutoActivation.findMany({
    where: {
      clientId: account.clientId,
      // Une recette archivée ne s'active plus : l'annoncer comme « manquante »
      // ferait miroiter un rattrapage que `deployTemplateToAccounts` refuse.
      patternTemplate: { isArchived: false },
    },
    select: { patternTemplateId: true, patternTemplate: { select: { label: true } } },
    // Borne de sécurité : au-delà c'est un script, pas un clic.
    take: DEPLOY_MAX_ACCOUNTS,
  });
  if (expected.length === 0) return [];

  const linked = await prisma.patternBinding.findMany({
    where: {
      accountId,
      patternTemplateId: { in: expected.map((e) => e.patternTemplateId) },
    },
    select: { patternTemplateId: true },
  });
  // Volontairement SANS filtre `isActive` : un binding désactivé à la main est
  // une décision, pas un oubli. Le re-proposer serait le défaire en boucle.
  const already = new Set(linked.map((b) => b.patternTemplateId));

  return expected
    .filter((e) => !already.has(e.patternTemplateId))
    .map((e) => ({ patternTemplateId: e.patternTemplateId, label: e.patternTemplate.label }));
}

/**
 * Crée les bindings manquants. `only` restreint aux recettes demandées (bouton
 * de rattrapage sur une sélection) ; sans lui, toutes les manquantes.
 *
 * Best-effort par recette : l'appelant (création de compte) ne doit jamais
 * échouer à cause d'une activation.
 */
export async function applyAutoActivations(
  accountId: string,
  ctx: UserContext,
  only?: string[],
): Promise<AutoActivationResult> {
  const missing = await listMissingAutoActivations(accountId);
  const wanted = only?.length
    ? missing.filter((m) => only.includes(m.patternTemplateId))
    : missing;

  const result: AutoActivationResult = { ok: [], failed: [] };

  for (const recipe of wanted) {
    try {
      const template = await prisma.patternTemplate.findUnique({
        where: { id: recipe.patternTemplateId },
        select: { autoActivateDayOfWeek: true, autoActivatePublishTime: true },
      });
      await deployTemplateToAccounts(
        {
          patternTemplateId: recipe.patternTemplateId,
          accountIds: [accountId],
          publishTime: template?.autoActivatePublishTime ?? "09:00",
          dayOfWeek: template?.autoActivateDayOfWeek ?? [],
        },
        ctx,
      );
      result.ok.push(recipe);
    } catch (err) {
      result.failed.push({
        ...recipe,
        error: err instanceof Error ? err.message : "Erreur inconnue",
      });
    }
  }

  return result;
}
