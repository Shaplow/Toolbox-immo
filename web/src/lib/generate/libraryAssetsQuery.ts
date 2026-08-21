/**
 * libraryAssetsQuery — helpers purs pour `GET /api/libraries/[libraryId]/assets`
 * (picker « Changer » du formulaire de génération, P5 hardening 21/08).
 *
 * Extraits de la route pour être testables sans DB (vitest env `node`), et
 * pour documenter clairement le mirroring avec `contentLibraryResolver.ts` :
 * cette route reste volontairement en Prisma ORM (`findMany`) plutôt qu'en SQL
 * brut comme le résolveur — les fonctions ci-dessous rejouent la MÊME
 * sémantique d'accès/burn-once/tags, en Prisma `WhereInput`.
 *
 * - A.2 : sans `accountId`, le picker reste strict (pool public uniquement,
 *   fail-closed) — mirror de `buildAccessFilter` côté résolveur. Voir
 *   `buildAssetsAccessWhere` pour l'historique (une version antérieure du fix
 *   relâchait ce filtre, revert suite à revue de sécurité).
 * - A.3 : exclut `disabled: true` + burn-once — mirror de `buildAccessFilter`/
 *   `buildBurnFilter` (contentLibraryResolver.ts).
 * - A.4 : règles de tags avancées (`tagConditions`/`tagConditionsOperator` +
 *   `tagFilter` littéral) — mirror de `buildTagFragment`.
 * - A.6 : plus de filtre de durée serveur — voir la route (grisage client).
 * - A.7 : clé de jointure usage effective (sentinelle `__shared__` en scope
 *   `shared`) — mirror du défaut scope-aware de
 *   `selectMediaAssetFromFolder` (contentLibraryResolver.ts).
 */

import type { Prisma } from "@prisma/client";
import type { TagCondition } from "@/types/template";
import { SHARED_USAGE_ACCOUNT_ID } from "@/lib/rotation/sentinels";

// ─── A.4 — règles de tags avancées : sérialisation + résolution ───────────

export interface TagRuleParams {
  tagConditions?: TagCondition[];
  tagConditionsOperator?: "AND" | "OR";
  /** Tag littéral (`MediaSelectionRuleConfig.tagFilter`) — distinct du tag
   *  dynamique déjà résolu depuis `tagFilterParam` (paramètre `tag` legacy). */
  tagFilter?: string;
}

/**
 * Résout les conditions `fromParam` d'une règle contre les valeurs courantes
 * du formulaire (client) — mirror de la résolution `fromParam` faite en SQL
 * par `buildTagFragment` (contentLibraryResolver.ts), mais en JS côté
 * `ListingForm` puisque le picker n'a pas accès à `formData` côté route.
 * Une condition `fromParam` dont le champ source est vide est silencieusement
 * ignorée (même comportement que le résolveur : pas de tag = pas de filtre).
 */
export function resolveTagConditionsForForm(
  conditions: TagCondition[] | undefined,
  formValues: Record<string, unknown>,
): TagCondition[] {
  if (!conditions?.length) return [];
  const resolved: TagCondition[] = [];
  for (const c of conditions) {
    if (c.fromParam) {
      const raw = formValues[c.tag];
      if (typeof raw === "string" && raw.trim()) {
        resolved.push({ tag: raw.trim(), negate: c.negate });
      }
      continue;
    }
    if (c.tag?.trim()) {
      resolved.push({ tag: c.tag.trim(), negate: c.negate });
    }
  }
  return resolved;
}

/**
 * Sérialise les règles de tags en JSON compact pour le query param `tagRules`
 * (A.4). Retourne `undefined` quand il n'y a rien à transmettre (repli sur le
 * paramètre `tag` legacy côté route).
 */
export function serializeTagRuleParams(rule: TagRuleParams): string | undefined {
  const conditions = rule.tagConditions?.filter((c) => c.tag?.trim());
  const hasConditions = !!conditions?.length;
  const literalTag = rule.tagFilter?.trim();
  if (!hasConditions && !literalTag) return undefined;
  const payload: TagRuleParams = {};
  if (hasConditions) {
    payload.tagConditions = conditions;
    payload.tagConditionsOperator = rule.tagConditionsOperator === "OR" ? "OR" : "AND";
  }
  if (literalTag) payload.tagFilter = literalTag;
  return JSON.stringify(payload);
}

/** Désérialise le paramètre `tagRules` — tolérant, `undefined` si absent/invalide. */
export function parseTagRuleParams(raw: string | null | undefined): TagRuleParams | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return undefined;
    const obj = parsed as Record<string, unknown>;
    const out: TagRuleParams = {};
    if (Array.isArray(obj.tagConditions)) {
      const conditions = obj.tagConditions.filter(
        (c): c is TagCondition => !!c && typeof c === "object" && typeof (c as TagCondition).tag === "string" && (c as TagCondition).tag.trim() !== "",
      );
      if (conditions.length > 0) out.tagConditions = conditions;
    }
    if (obj.tagConditionsOperator === "OR" || obj.tagConditionsOperator === "AND") {
      out.tagConditionsOperator = obj.tagConditionsOperator;
    }
    if (typeof obj.tagFilter === "string" && obj.tagFilter.trim()) {
      out.tagFilter = obj.tagFilter.trim();
    }
    return Object.keys(out).length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Fragment `where` pour le filtre de tags — mirror ORM de `buildTagFragment`
 * (contentLibraryResolver.ts, raw SQL) : `tagConditions` (nouveau style)
 * remplace ENTIÈREMENT `tagFilter`/le tag legacy quand présent (même
 * précédence que le résolveur), sinon repli sur `tagRules.tagFilter` littéral,
 * sinon sur `legacyTag` (résolu côté client depuis `tagFilterParam`).
 */
export function buildTagRulesWhere(
  legacyTag: string,
  tagRules: TagRuleParams | undefined,
): Prisma.MediaAssetWhereInput {
  if (tagRules?.tagConditions?.length) {
    const clauses: Prisma.MediaAssetWhereInput[] = tagRules.tagConditions
      .map((c): Prisma.MediaAssetWhereInput | null => {
        const t = c.tag?.trim().toLowerCase();
        if (!t) return null;
        const cond: Prisma.MediaAssetWhereInput = { tags: { contains: `"${t}"`, mode: "insensitive" } };
        return c.negate ? { NOT: cond } : cond;
      })
      .filter((c): c is Prisma.MediaAssetWhereInput => c !== null);
    if (clauses.length === 0) return {};
    return tagRules.tagConditionsOperator === "OR" ? { OR: clauses } : { AND: clauses };
  }
  if (tagRules?.tagFilter) {
    return { tags: { contains: `"${tagRules.tagFilter.trim().toLowerCase()}"`, mode: "insensitive" } };
  }
  if (legacyTag) {
    return { tags: { contains: `"${legacyTag.trim().toLowerCase()}"`, mode: "insensitive" } };
  }
  return {};
}

// ─── A.2 — accès ────────────────────────────────────────────────────────

/**
 * Fragment `where` d'accès — mirror ORM de `buildAccessFilter`
 * (contentLibraryResolver.ts). Reste STRICT (fail-closed) sans `accountId`,
 * exactement comme `buildAccessFilter` côté résolveur : la « vraie faille »
 * A.2 identifiée par le diagnostic P5 n'était pas ce repli strict lui-même,
 * mais la course A.1 qui perdait temporairement l'`accountId` connu — corrigée
 * séparément dans `ListingForm.tsx` (`selectedAccountId ||
 * libraryPrefillContext.selectedAccountId`, picker désactivé pendant
 * `prefillLoading`). Une première version de ce fix relâchait le filtre à
 * "montrer tout" sans `accountId` ; revue de sécurité (post-implémentation) :
 * ça exposait la vignette/lecture des assets `MediaAssetAccess`-restreints à
 * un autre client, à n'importe quel user authentifié ouvrant le picker sans
 * compte sélectionné. `validateManualAssetSelection` (A.9, `/api/renders`)
 * bloque bien l'USAGE d'un tel asset au submit, mais ne referme pas la fuite
 * de preview — d'où le repli strict conservé ici.
 */
export function buildAssetsAccessWhere(accountId: string | null): Prisma.MediaAssetWhereInput {
  if (!accountId) return { accesses: { none: {} } };
  return { OR: [{ accesses: { none: {} } }, { accesses: { some: { accountId } } }] };
}

// ─── A.3 — disabled + burn-once ────────────────────────────────────────

/**
 * Fragment `where` burn-once — mirror ORM de `buildBurnFilter`
 * (contentLibraryResolver.ts). `burnAccountId` doit déjà être résolu
 * scope-aware (voir `resolveBurnAccountId`) : `undefined` = compteur global
 * `MediaAsset.usageCount` (scope `shared`, ou aucun compte connu), une valeur
 * = compteur par compte réel `MediaAssetUsage.usageCount` (scope `per_account`).
 */
export function buildAssetsBurnWhere(
  maxUsageCount: number | null,
  burnAccountId: string | undefined,
): Prisma.MediaAssetWhereInput {
  if (maxUsageCount == null || maxUsageCount <= 0) return {};
  if (burnAccountId) {
    return { NOT: { usages: { some: { accountId: burnAccountId, usageCount: { gte: maxUsageCount } } } } };
  }
  return { usageCount: { lt: maxUsageCount } };
}

/**
 * Clé de compte pour le burn-once (A.3) — scope-aware comme
 * `selectMediaAssetFromFolder` : une lib `shared` compte toujours sur le
 * compteur global (`ma.usageCount`), jamais sur un compte réel ni sur la
 * sentinelle. `per_account` compte par compte réel quand connu.
 */
export function resolveBurnAccountId(
  rotationScope: string | null | undefined,
  accountId: string | null,
): string | undefined {
  if (rotationScope === "shared") return undefined;
  return accountId ?? undefined;
}

// ─── A.7 — clé de jointure usage effective ─────────────────────────────

/**
 * Clé `MediaAssetUsage.accountId` à utiliser pour les compteurs d'usage
 * affichés dans le picker (A.7) — sentinelle `__shared__` pour les libs en
 * scope `shared`, sinon le compte réel. Mirror du défaut scope-aware posé
 * dans `selectMediaAssetFromFolder` (`effectiveUsageId`) : avant ce fix, le
 * picker joignait toujours sur le compte réel même en scope `shared`, où les
 * lignes d'usage sont écrites sous la sentinelle — les compteurs affichés
 * étaient donc systématiquement à 0/périmés pour ces bibliothèques.
 * `null` = pas de compte connu → pas de jointure (compteurs globaux).
 */
export function resolveUsageKey(
  rotationScope: string | null | undefined,
  accountId: string | null,
): string | null {
  if (!accountId) return null;
  return rotationScope === "shared" ? SHARED_USAGE_ACCOUNT_ID : accountId;
}
