"use client";

/**
 * useMediaAssetsLoader — fetch + parsing des MediaAsset d'une library.
 *
 * Perf (2026-07) :
 *  - Le chargement lourd du tableau d'assets est **clé sur libraryId uniquement**.
 *    Le compte (`accountFilter`) n'affecte que `usageCount`/`lastUsedAt` : on les
 *    remappe via un endpoint léger `/usages?accountId=` au lieu de retélécharger
 *    tout le payload (url/metadata/…) à chaque changement de compte.
 *  - Cache module-level (stale-while-revalidate maison) : au retour sur une
 *    bibliothèque déjà visitée, on hydrate l'affichage **synchronement** puis on
 *    revalide en arrière-plan — pas de spinner, pas d'attente réseau.
 *
 * Le hook expose `setAssets` (wrappé pour aussi réécrire le cache) car le
 * composant parent met à jour le state localement après edit/delete/bulk
 * (40+ call sites).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { MediaAsset } from "./types";

interface UseMediaAssetsLoaderResult {
  assets: MediaAsset[];
  setAssets: Dispatch<SetStateAction<MediaAsset[]>>;
  loading: boolean;
  loadError: string | null;
  refetch: () => Promise<void>;
}

type ApiAsset = Omit<MediaAsset, "tags" | "accessAccountIds"> & {
  tags: string;
  accessAccountIds?: string[];
};

type UsageRow = { assetId: string; usageCount: number; lastUsedAt: string | null };

/**
 * Cache module-level : survit au démontage/remontage du panel dans la SPA.
 * Stocke le dernier état connu des assets par library (essentiellement les
 * valeurs « tous comptes »). Sert d'hydratation instantanée au retour sur la
 * page ; la revalidation en fond corrige toute donnée périmée en <1s.
 */
const assetsCache = new Map<string, MediaAsset[]>();

function parseAsset(a: ApiAsset): MediaAsset {
  return {
    ...a,
    setTag: (a as unknown as { setTag?: string | null }).setTag ?? null,
    tags: (() => {
      try {
        return JSON.parse(a.tags) as string[];
      } catch {
        return [];
      }
    })(),
    metadata: (() => {
      try {
        const m = (a as unknown as { metadata?: string }).metadata;
        return m ? (JSON.parse(m) as Record<string, string | number | null>) : {};
      } catch {
        return {};
      }
    })(),
    accessAccountIds: a.accessAccountIds ?? [],
    pendingEditJob:
      (a as unknown as { pendingEditJob?: { id: string; status: string } | null })
        .pendingEditJob ?? null,
  };
}

export function useMediaAssetsLoader(
  libraryId: string,
  accountFilter: string | null,
): UseMediaAssetsLoaderResult {
  const cached = assetsCache.get(libraryId);
  const [assets, setAssetsState] = useState<MediaAsset[]>(cached ?? []);
  // Pas de spinner si on a déjà des données en cache (revalidation silencieuse).
  const [loading, setLoading] = useState(!cached);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Incrémenté après chaque chargement lourd → rejoue l'overlay usage par compte.
  const [loadTick, setLoadTick] = useState(0);
  // Snapshot des usages « tous comptes » (issus du fetch /assets sans compte),
  // pour restaurer ces valeurs sans retélécharger le payload lourd.
  const baseUsageRef = useRef<Map<string, { usageCount: number; lastUsedAt: string | null }>>(
    new Map(),
  );

  // setAssets wrappé : met à jour le state ET le cache module-level, pour que
  // les mutations locales (edit tag/catégorie, suppression, bulk…) soient
  // reflétées au prochain retour sur la page (sinon on resservirait du périmé).
  const setAssets = useCallback<Dispatch<SetStateAction<MediaAsset[]>>>(
    (update) => {
      setAssetsState((prev) => {
        const next =
          typeof update === "function"
            ? (update as (p: MediaAsset[]) => MediaAsset[])(prev)
            : update;
        assetsCache.set(libraryId, next);
        return next;
      });
    },
    [libraryId],
  );

  // Chargement lourd du tableau d'assets (sans accountId → usages globaux).
  const refetch = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`/api/admin/libraries/media/${libraryId}/assets`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = (await res.json()) as ApiAsset[];
      const parsed = raw.map(parseAsset);
      baseUsageRef.current = new Map(
        parsed.map((a) => [a.id, { usageCount: a.usageCount, lastUsedAt: a.lastUsedAt }]),
      );
      assetsCache.set(libraryId, parsed);
      setAssetsState(parsed);
      setLoadTick((t) => t + 1);
    } catch (err) {
      console.error("[useMediaAssetsLoader] load error:", err);
      setLoadError(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, [libraryId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Overlay usage par compte : remappe usageCount/lastUsedAt sans retélécharger
  // le payload lourd. Rejoué après chaque chargement lourd (loadTick) pour rester
  // cohérent même si un fetch est relancé alors qu'un compte est sélectionné.
  useEffect(() => {
    if (!accountFilter) {
      // Retour « tous comptes » → restaurer les valeurs globales snapshot.
      setAssetsState((prev) => {
        if (prev.length === 0) return prev;
        let changed = false;
        const next = prev.map((a) => {
          const g = baseUsageRef.current.get(a.id);
          if (!g || (g.usageCount === a.usageCount && g.lastUsedAt === a.lastUsedAt)) return a;
          changed = true;
          return { ...a, usageCount: g.usageCount, lastUsedAt: g.lastUsedAt };
        });
        return changed ? next : prev;
      });
      return;
    }
    const ctrl = new AbortController();
    void (async () => {
      try {
        const res = await fetch(
          `/api/admin/libraries/media/${libraryId}/usages?accountId=${encodeURIComponent(accountFilter)}`,
          { signal: ctrl.signal },
        );
        if (!res.ok) return;
        const usages = (await res.json()) as UsageRow[];
        const map = new Map(usages.map((u) => [u.assetId, u]));
        setAssetsState((prev) =>
          prev.map((a) => {
            const u = map.get(a.id);
            return { ...a, usageCount: u?.usageCount ?? 0, lastUsedAt: u?.lastUsedAt ?? null };
          }),
        );
      } catch {
        // Abort (déps changées / unmount) ou erreur réseau → on garde l'affichage courant.
      }
    })();
    return () => ctrl.abort();
  }, [libraryId, accountFilter, loadTick]);

  return { assets, setAssets, loading, loadError, refetch };
}
