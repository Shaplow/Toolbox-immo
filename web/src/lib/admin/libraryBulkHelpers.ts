/**
 * Helpers partagés pour les routes bulk media/data libraries.
 *
 * Avant la consolidation : chaque route bulk (media + data) ré-implémentait
 * indépendamment la validation des champs IDs + accessAction + accountId/accountIds,
 * avec des subtiles divergences (ordre des checks, messages d'erreur). Le helper
 * unifie le contrat pour réduire le drift.
 */

export interface ParsedBulkAccess {
  /** IDs validés (string non-vide). */
  ids: string[];
  /** Action access ou null si pas une opération access. */
  action: "add" | "remove_all" | null;
  /** Liste des accountIds résolue (depuis accountId scalaire OU accountIds[]). */
  accountIds: string[];
}

export interface BulkParseError {
  status: 400;
  message: string;
}

/**
 * Parse le tronc commun d'un body bulk : `<idsField>: string[]`, `accessAction`,
 * `accountId`/`accountIds[]`. Retourne soit l'objet parsé soit une erreur 400
 * structurée à renvoyer telle quelle.
 *
 * - `idsField` : nom du champ contenant les IDs (assetIds | entryIds).
 * - `requireAction` : si true, refuse si `accessAction` n'est pas fourni ou invalide.
 *   Si false, retourne `action: null` quand le champ est absent (utile quand
 *   d'autres champs comme tags/setTag/metadata peuvent suffire à valider le PATCH).
 */
export function parseBulkAccessBody(
  body: Record<string, unknown>,
  idsField: string,
  options: { requireAction?: boolean } = {},
): ParsedBulkAccess | BulkParseError {
  const rawIds = body[idsField];
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return { status: 400, message: `${idsField} est requis et doit être un tableau non vide` };
  }
  const ids = rawIds.filter((id): id is string => typeof id === "string");
  if (ids.length === 0) {
    return { status: 400, message: `${idsField} invalides` };
  }
  if (ids.length !== rawIds.length) {
    return {
      status: 400,
      message: `${idsField} invalides : ${
        rawIds.length - ids.length
      } entrée(s) ne sont pas des chaînes de caractères`,
    };
  }

  const rawAction = body.accessAction;
  const action = typeof rawAction === "string" ? rawAction : null;
  if (action !== null && action !== "add" && action !== "remove_all") {
    return { status: 400, message: 'accessAction doit être "add" ou "remove_all"' };
  }
  if (options.requireAction && action === null) {
    return { status: 400, message: "accessAction est requis" };
  }

  // Résolution accountIds : accountIds[] prioritaire, sinon accountId scalaire
  // (legacy single). Caller décide si la liste vide est acceptable selon l'action.
  const accountIds: string[] = Array.isArray(body.accountIds)
    ? body.accountIds.filter((s): s is string => typeof s === "string")
    : typeof body.accountId === "string"
      ? [body.accountId]
      : [];

  if (action === "add" && accountIds.length === 0) {
    return {
      status: 400,
      message: "accountId (ou accountIds[]) requis pour l'action add",
    };
  }

  return { ids, action, accountIds };
}

export function isBulkParseError(value: unknown): value is BulkParseError {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    (value as { status: unknown }).status === 400
  );
}
