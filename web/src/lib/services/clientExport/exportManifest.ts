/**
 * Manifeste d'un lien d'export : la liste des fichiers à écrire chez le client,
 * avec leur chemin et leur taille, plus la table ref → élément qui autorise la
 * signature des URLs (une ref absente du manifeste n'est jamais signée).
 *
 * Mis en cache 5 min par lien (globalThis : survit au HMR, process PM2 unique) :
 * la page appelle `urls` des centaines de fois pendant un téléchargement, sans
 * recalculer le périmètre à chaque lot. Un seul calcul en cours par lien.
 */

import { createPresignedGetUrl } from "@/lib/r2";
import { isLocalStorage } from "@/lib/storage";
import { buildExportTree } from "@/lib/clientExport/tree";
import { COMMON_ACCOUNT_REF } from "@/lib/clientExport/ids";
import type {
  ExportItem,
  ExportManifest,
  ExportRef,
  ExportUrlsResponse,
} from "@/lib/clientExport/types";
import type { VerifiedExportLink } from "./exportLinks";
import { resolveExportScope } from "./exportScope";
import { ensureExportSizes } from "./exportSizes";

const MANIFEST_TTL_MS = 5 * 60 * 1000;
const MAX_CACHED_LINKS = 20;

/** URL signée pour 1 h : demandée juste avant chaque fichier, elle n'attend jamais. */
const SIGNED_URL_TTL_S = 3600;

interface BuiltManifest {
  /** Sans les champs propres à la requête (expiration, client), recalculés à chaque appel. */
  body: Omit<ExportManifest, "linkId" | "clientName" | "expiresAt">;
  items: Map<ExportRef, ExportItem>;
}

type CacheEntry = { at: number; promise: Promise<BuiltManifest> };
const globalCache = globalThis as unknown as { __clientExportManifests?: Map<string, CacheEntry> };
const manifestCache = (globalCache.__clientExportManifests ??= new Map<string, CacheEntry>());

async function buildManifest(link: VerifiedExportLink): Promise<BuiltManifest> {
  const scope = await resolveExportScope(link.selection);

  const accountName = new Map(scope.accounts.map((a) => [a.id, a.name]));
  const libraryName = new Map(scope.libraries.map((l) => [l.id, l.name]));
  const labelOf = (item: ExportItem): string => {
    const owner = item.accountId ? (accountName.get(item.accountId) ?? "Compte") : "Commun";
    switch (item.kind) {
      case "media":
        return `${owner} — ${libraryName.get(item.libraryId) ?? "Bibliothèque"} — ${item.filename}`;
      case "data":
        return `${owner} — ${libraryName.get(item.libraryId) ?? "Données"}`;
      case "publication":
        return `${owner} — ${item.label}`;
    }
  };

  const sized = await ensureExportSizes(scope.items, labelOf);
  const tree = buildExportTree({
    clientName: link.clientName,
    accounts: scope.accounts,
    libraries: scope.libraries,
    items: sized.items,
  });

  // Comptes réellement servis — « Commun » n'en est pas un.
  const servedAccounts = new Set(sized.items.flatMap((item) => (item.accountId ? [item.accountId] : [])));
  const bytes = tree.files.reduce((sum, f) => sum + (f.size ?? 0), 0);
  const skipped = [...scope.skipped, ...sized.skipped].map(({ label, reason }) => ({ label, reason }));

  return {
    body: {
      rootName: tree.rootName,
      files: tree.files,
      skipped,
      totals: { files: tree.files.length, bytes, accounts: servedAccounts.size },
    },
    items: new Map(sized.items.map((item) => [item.ref, item])),
  };
}

async function getBuiltManifest(link: VerifiedExportLink): Promise<BuiltManifest> {
  const now = Date.now();
  const hit = manifestCache.get(link.id);
  if (hit && now - hit.at < MANIFEST_TTL_MS) return hit.promise;

  const promise = buildManifest(link);
  manifestCache.delete(link.id);
  manifestCache.set(link.id, { at: now, promise });
  // Un échec ne doit pas rester en cache.
  promise.catch(() => {
    if (manifestCache.get(link.id)?.promise === promise) manifestCache.delete(link.id);
  });
  while (manifestCache.size > MAX_CACHED_LINKS) {
    const oldest = manifestCache.keys().next().value;
    if (oldest === undefined) break;
    manifestCache.delete(oldest);
  }
  return promise;
}

/** Oublie le manifeste d'un lien (révocation, changement de sélection). */
export function invalidateExportManifest(linkId: string): void {
  manifestCache.delete(linkId);
}

export async function getExportManifest(link: VerifiedExportLink): Promise<ExportManifest> {
  const built = await getBuiltManifest(link);
  return {
    linkId: link.id,
    clientName: link.clientName,
    expiresAt: link.expiresAt.toISOString(),
    ...built.body,
  };
}

/**
 * URLs des refs demandées. Une ref hors du manifeste (ou devenue introuvable)
 * est renvoyée dans `missing`, jamais signée : c'est la garde anti-IDOR.
 */
export async function signExportRefs(
  link: VerifiedExportLink,
  rawToken: string,
  refs: ExportRef[],
): Promise<ExportUrlsResponse> {
  const built = await getBuiltManifest(link);
  const local = isLocalStorage();
  const urls: Record<ExportRef, string> = {};
  const missing: ExportRef[] = [];

  for (const ref of refs) {
    const item = built.items.get(ref);
    if (!item) {
      missing.push(ref);
      continue;
    }
    switch (item.kind) {
      case "media":
        // Local : le fichier est derrière asset.url (same-origin), pas derrière r2Key.
        urls[ref] = local ? item.url.split(/[?#]/)[0] : await createPresignedGetUrl(item.r2Key, SIGNED_URL_TTL_S);
        break;
      case "publication":
        if (local) {
          if (item.localUrl) urls[ref] = item.localUrl.split(/[?#]/)[0];
          else missing.push(ref);
        } else {
          urls[ref] = await createPresignedGetUrl(item.r2Key, SIGNED_URL_TTL_S);
        }
        break;
      case "data":
        // Généré à la demande par la route publique `data` (same-origin).
        urls[ref] =
          `/api/export/${rawToken}/data/${item.libraryId}` +
          `?account=${encodeURIComponent(item.accountId ?? COMMON_ACCOUNT_REF)}`;
        break;
    }
  }
  return { urls, missing };
}

/** L'élément de données d'un lien, s'il fait bien partie du manifeste. */
export async function findExportDataItem(
  link: VerifiedExportLink,
  ref: ExportRef,
): Promise<Extract<ExportItem, { kind: "data" }> | null> {
  const built = await getBuiltManifest(link);
  const item = built.items.get(ref);
  return item?.kind === "data" ? item : null;
}
