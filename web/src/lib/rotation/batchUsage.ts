/**
 * batchUsage.ts — registre d'usage virtuel pour le tirage en lot.
 *
 * Contexte (plan « lancer les rendus depuis le calendrier », étape 3) : le
 * pré-remplissage du formulaire de génération est en lecture seule — les
 * claims (`advanceMediaUsageOnSubmit`, `advanceDataUsageOnSubmit`) n'ont lieu
 * qu'au submit. Appeler `resolveLibraryPrefill` plusieurs fois d'affilée pour
 * plusieurs publications (le lot) donnerait donc TOUJOURS le même pick pour
 * chaque bibliothèque tant qu'aucune n'a réellement soumis son render — le
 * lot ne ferait pas ce que ferait le formulaire lancé une publication après
 * l'autre.
 *
 * Le registre simule, en mémoire, que chaque pick déjà retenu par une ligne
 * PRÉCÉDENTE du lot vient d'être claimé, sans jamais écrire en base. Les
 * fonctions de sélection du résolveur (`selectMediaAsset`,
 * `selectMediaAssetFromFolder`, `selectDataEntry`) le consultent en lecture
 * seule (`BatchUsageView`) pour ajuster leur tri et leur garde burn-once ;
 * seul le service de lot (`bulkRenderService`, hors périmètre de ce fichier)
 * y écrit (`BatchUsageLedger.record`), une fois le statut d'une ligne
 * `ready` connu — jamais pour une ligne `needs_property` ou `incomplete`.
 *
 * Contrat dur : SANS vue passée, chaque requête SQL émise par le résolveur
 * reste identique au caractère près à celle d'aujourd'hui. Les fragments
 * construits ici ne sont donc JAMAIS insérés dans un template Prisma.sql
 * existant sous une forme qui produirait du texte (même vide) quand
 * `entriesFor(...)` renvoie `null` — les call sites choisissent entre deux
 * templates distincts plutôt que d'interpoler un fragment conditionnel dans
 * un unique template (un fragment vide change quand même l'espacement autour
 * de son point d'interpolation — vérifié empiriquement sur `Prisma.sql`).
 */

import { Prisma } from "@prisma/client";

/**
 * Agrégat PAR ASSET pour une clé `libraryId|usageKey` donnée.
 * - `seq` = rang du DERNIER enregistrement (compteur monotone du registre,
 *   partagé par tout le registre) — pilote le tri "vient d'être servi".
 * - `n`   = nombre de fois où l'asset a été enregistré sous cette clé —
 *   pilote le burn-once virtuel.
 * Les 3 tableaux sont alignés par index (ids[i] ↔ seqs[i] ↔ ns[i]).
 */
export interface BatchUsageEntries {
  ids: string[];
  seqs: number[];
  ns: number[];
}

export interface BatchUsageView {
  /** `null` quand rien n'a été enregistré pour cette `libraryId`+`usageKey`. */
  entriesFor(libraryId: string, usageKey: string | null | undefined): BatchUsageEntries | null;
}

export interface BatchUsageLedger extends BatchUsageView {
  /**
   * Enregistre un pick. Idempotent par agrégation : un même asset noté
   * plusieurs fois sous la même clé s'agrège (n += 1, seq = rang du dernier
   * enregistrement) au lieu de dupliquer une ligne.
   */
  record(libraryId: string, usageKey: string | null | undefined, assetId: string): void;
}

/** `${libraryId}|${usageKey ?? "*"}` — clé d'agrégation du registre. */
export function batchUsageKey(libraryId: string, usageKey: string | null | undefined): string {
  return `${libraryId}|${usageKey ?? "*"}`;
}

type PerAssetState = { lastSeq: number; n: number };

export function createBatchUsageLedger(): BatchUsageLedger {
  const table = new Map<string, Map<string, PerAssetState>>();
  // Compteur monotone PARTAGÉ par tout le registre (pas remis à zéro par
  // clé) : deux enregistrements sur la MÊME clé restent toujours seq-croissants,
  // ce qui garantit qu'un pick "vient d'être servi" trie bien après tout ce
  // qui a été enregistré avant lui, quel que soit l'ordre des bibliothèques.
  let counter = 0;

  return {
    record(libraryId, usageKey, assetId) {
      const key = batchUsageKey(libraryId, usageKey);
      let byAsset = table.get(key);
      if (!byAsset) {
        byAsset = new Map();
        table.set(key, byAsset);
      }
      counter += 1;
      const prev = byAsset.get(assetId);
      byAsset.set(assetId, { lastSeq: counter, n: (prev?.n ?? 0) + 1 });
    },
    entriesFor(libraryId, usageKey) {
      const byAsset = table.get(batchUsageKey(libraryId, usageKey));
      if (!byAsset || byAsset.size === 0) return null;
      const ids: string[] = [];
      const seqs: number[] = [];
      const ns: number[] = [];
      for (const [id, state] of byAsset) {
        ids.push(id);
        seqs.push(state.lastSeq);
        ns.push(state.n);
      }
      return { ids, seqs, ns };
    },
  };
}

/**
 * Jointure du registre virtuel sur la table appelante — toujours appelée
 * avec des `entries` non-null (le call site tranche en amont via
 * `entriesFor`). `idExpr` est l'alias.colonne de la table jointe (`ma.id` ou
 * `de.id` selon l'appelant).
 *
 * `unnest` sur 3 tableaux parallèles : Prisma sérialise un tableau JS en
 * paramètre `::text[]`/`::int[]` nativement pour le driver `pg` — validé par
 * un script scratch en lecture seule sur la base locale (voir rapport de
 * l'agent).
 */
export function buildBatchUsageJoin(entries: BatchUsageEntries, idExpr: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`LEFT JOIN unnest(${entries.ids}::text[], ${entries.seqs}::int[], ${entries.ns}::int[]) AS vu(asset_id, seq, n) ON vu.asset_id = ${idExpr}`;
}

/**
 * Dernier usage EFFECTIF : un asset présent dans le registre virtuel trie
 * comme s'il venait d'être servi À L'INSTANT — plus loin dans le futur que
 * n'importe quel `lastUsedAt` réel — ordonné entre eux par `seq` (le plus
 * récemment recordé trie le plus loin). Pas de fuseau, pas de dérive
 * d'horloge : `TIMESTAMP '9999-01-01'` est une borne fixe, `seq` est un
 * entier JS, jamais `now()`.
 */
export function buildEffectiveLastUsedExpr(realExpr: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`CASE WHEN vu.asset_id IS NOT NULL THEN TIMESTAMP '9999-01-01' + vu.seq * INTERVAL '1 millisecond' ELSE ${realExpr} END`;
}

/**
 * « Jamais servi » EFFECTIF : vrai seulement si l'asset n'a NI usage réel NI
 * pick virtuel dans le lot. `realUnusedExpr` est déjà le booléen réel
 * (ex. `mau."lastUsedAt" IS NULL`), pas la valeur brute.
 */
export function buildEffectiveUnusedExpr(realUnusedExpr: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(${realUnusedExpr} AND vu.asset_id IS NULL)`;
}

/**
 * Compteur d'usage EFFECTIF pour `least_used` : usage réel + occurrences
 * virtuelles dans le lot. `realCountExpr` peut être NULL (LEFT JOIN sans
 * ligne) — toujours COALESCE des deux côtés.
 */
export function buildEffectiveUsageCountExpr(realCountExpr: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(COALESCE(${realCountExpr}, 0) + COALESCE(vu.n, 0))`;
}

/**
 * Garde burn-once VIRTUELLE — fragment additionnel (`AND (...)`) posé EN PLUS
 * du burn-once réel (`buildBurnFilter`) : un asset sous la limite réelle mais
 * que le lot a déjà servi assez de fois pour atteindre `maxUsageCount` est
 * exclu ici. `Prisma.empty` quand `maxUsageCount` est vide/nul (rotation
 * infinie) — jamais posée pour un pool sans plafond. Un stock épuisé fait
 * remonter zéro ligne (le call site retombe sur son `null` habituel), jamais
 * un dépassement silencieux du plafond réel.
 */
export function buildVirtualBurnFilter(
  realCountExpr: Prisma.Sql,
  maxUsageCount: number | null | undefined,
): Prisma.Sql {
  if (maxUsageCount == null || maxUsageCount <= 0) return Prisma.empty;
  return Prisma.sql`AND (vu.n IS NULL OR ${realCountExpr} + vu.n < ${maxUsageCount})`;
}
