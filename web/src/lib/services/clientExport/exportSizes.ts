/**
 * Tailles des fichiers d'un export.
 *
 * La page publique en a besoin AVANT de télécharger : volume total annoncé, et
 * surtout reprise (un fichier déjà présent à la bonne taille est sauté). Elle
 * sert aussi à repérer les fichiers absents du stockage (upload jamais
 * terminé, objet supprimé), écartés plutôt que de faire échouer le client.
 *
 * - Médias : MediaAsset.sizeBytes ; les tailles inconnues (assets historiques)
 *   sont retrouvées puis PERSISTÉES — un seul listing R2 au-delà de
 *   LIST_THRESHOLD, sinon un HEAD par fichier en concurrence bornée (process
 *   PM2 unique).
 * - Publications : fileSizeBytes de la version (INT4, déclaré au dépôt), sinon
 *   HEAD, mis en cache : ces clés ne sont jamais réécrites.
 * - Données : taille inconnue d'avance (fichier généré à la demande).
 */

import { prisma } from "@/lib/prisma";
import { headR2Object, listR2ObjectSizes } from "@/lib/r2";
import { isLocalStorage, localFileSizeForUrl } from "@/lib/storage";
import { mapWithConcurrencySettled } from "@/lib/concurrency";
import { statMediaAssetFile } from "@/lib/services/mediaAsset/assetSize";
import type { ExportItem, MediaExportItem, PublicationExportItem } from "@/lib/clientExport/types";
import type { ScopeSkipped } from "./exportScope";

/** Au-delà, un listing des préfixes médias coûte moins qu'un HEAD par fichier. */
const LIST_THRESHOLD = 150;
const HEAD_CONCURRENCY = 8;
const MEDIA_PREFIXES = ["content-library/videos/", "content-library/audio/"] as const;

/** Clés immuables (versions, renders, sorties sous-titrées) : taille gardée 24 h, absence 10 min. */
const FOUND_TTL_MS = 24 * 60 * 60 * 1000;
const MISSING_TTL_MS = 10 * 60 * 1000;
const MAX_CACHED_KEYS = 20_000;

type CachedSize = { size: number | null; at: number };
const globalCache = globalThis as unknown as { __clientExportSizes?: Map<string, CachedSize> };
const sizeCache = (globalCache.__clientExportSizes ??= new Map<string, CachedSize>());

function cachedSize(key: string, now: number): CachedSize | undefined {
  const hit = sizeCache.get(key);
  if (!hit) return undefined;
  const ttl = hit.size == null ? MISSING_TTL_MS : FOUND_TTL_MS;
  if (now - hit.at > ttl) {
    sizeCache.delete(key);
    return undefined;
  }
  return hit;
}

function rememberSize(key: string, size: number | null, now: number) {
  if (sizeCache.size >= MAX_CACHED_KEYS) {
    // Map garde l'ordre d'insertion : on retire le plus ancien quart.
    let drop = Math.ceil(MAX_CACHED_KEYS / 4);
    for (const k of sizeCache.keys()) {
      sizeCache.delete(k);
      if (--drop === 0) break;
    }
  }
  sizeCache.set(key, { size, at: now });
}

type SizeOutcome = { kind: "size"; size: number } | { kind: "missing" } | { kind: "unknown" };

/** Tailles des médias sans sizeBytes, par assetId (dédoublonnés : un asset peut servir deux comptes). */
async function resolveMediaSizes(missing: MediaExportItem[]): Promise<Map<string, SizeOutcome>> {
  const byAsset = new Map<string, MediaExportItem>();
  for (const item of missing) byAsset.set(item.assetId, item);
  const outcomes = new Map<string, SizeOutcome>();
  if (byAsset.size === 0) return outcomes;

  const assets = [...byAsset.values()];
  if (!isLocalStorage() && assets.length > LIST_THRESHOLD) {
    const listed = await listR2ObjectSizes(MEDIA_PREFIXES);
    for (const asset of assets) {
      const size = listed.get(asset.r2Key);
      outcomes.set(asset.assetId, size == null ? { kind: "missing" } : { kind: "size", size });
    }
  } else {
    const results = await mapWithConcurrencySettled(assets, HEAD_CONCURRENCY, (asset) =>
      statMediaAssetFile({ r2Key: asset.r2Key, url: asset.url }),
    );
    results.forEach((result, index) => {
      const asset = assets[index];
      if (!result.ok) {
        // Erreur réseau persistante : taille inconnue, mais le fichier reste
        // proposé (le téléchargement dira s'il existe).
        console.warn(`[clientExport] HEAD impossible pour ${asset.r2Key} :`, result.error);
        outcomes.set(asset.assetId, { kind: "unknown" });
      } else {
        outcomes.set(asset.assetId, result.value == null ? { kind: "missing" } : { kind: "size", size: result.value });
      }
    });
  }

  // Persister ce qui a été trouvé : le prochain aperçu n'aura plus à le chercher.
  const found = [...outcomes].filter(
    (entry): entry is [string, { kind: "size"; size: number }] => entry[1].kind === "size",
  );
  await mapWithConcurrencySettled(found, HEAD_CONCURRENCY, ([assetId, outcome]) =>
    prisma.mediaAsset.update({ where: { id: assetId }, data: { sizeBytes: BigInt(outcome.size) } }),
  );
  return outcomes;
}

async function resolvePublicationSize(item: PublicationExportItem, now: number): Promise<SizeOutcome> {
  if (item.localUrl) {
    const size = await localFileSizeForUrl(item.localUrl);
    return size == null ? { kind: "missing" } : { kind: "size", size };
  }
  if (isLocalStorage()) return { kind: "missing" };

  const hit = cachedSize(item.r2Key, now);
  if (hit) return hit.size == null ? { kind: "missing" } : { kind: "size", size: hit.size };
  try {
    const head = await headR2Object(item.r2Key);
    rememberSize(item.r2Key, head?.contentLength ?? null, now);
    return head ? { kind: "size", size: head.contentLength } : { kind: "missing" };
  } catch (err) {
    console.warn(`[clientExport] HEAD impossible pour ${item.r2Key} :`, err);
    return { kind: "unknown" };
  }
}

/**
 * Complète les tailles et écarte les fichiers introuvables.
 * `labelOf` fournit le libellé lisible d'un élément écarté.
 */
export async function ensureExportSizes(
  items: ExportItem[],
  labelOf: (item: ExportItem) => string,
): Promise<{ items: ExportItem[]; skipped: ScopeSkipped[] }> {
  const now = Date.now();
  const mediaOutcomes = await resolveMediaSizes(
    items.filter((i): i is MediaExportItem => i.kind === "media" && i.sizeBytes == null),
  );

  const publications = items.filter(
    (i): i is PublicationExportItem => i.kind === "publication" && i.sizeBytes == null,
  );
  const publicationResults = await mapWithConcurrencySettled(publications, HEAD_CONCURRENCY, (item) =>
    resolvePublicationSize(item, now),
  );
  const publicationOutcomes = new Map<string, SizeOutcome>();
  publicationResults.forEach((result, index) => {
    publicationOutcomes.set(publications[index].ref, result.ok ? result.value : { kind: "unknown" });
  });

  const kept: ExportItem[] = [];
  const skipped: ScopeSkipped[] = [];
  for (const item of items) {
    const outcome =
      item.kind === "media" && item.sizeBytes == null
        ? mediaOutcomes.get(item.assetId)
        : item.kind === "publication" && item.sizeBytes == null
          ? publicationOutcomes.get(item.ref)
          : undefined;

    if (outcome?.kind === "missing") {
      skipped.push({ kind: item.kind, accountId: item.accountId, reason: "missing", label: labelOf(item) });
      continue;
    }
    if (outcome?.kind === "size" && item.kind !== "data") {
      kept.push({ ...item, sizeBytes: outcome.size });
      continue;
    }
    kept.push(item);
  }
  return { items: kept, skipped };
}
