"use client";

/**
 * useMediaAssetsLoader — encapsule le fetch + parsing des MediaAsset
 * pour une library donnée.
 *
 * Première brique du split C1-v2 §19 (étape 2 du plan §15.2). Le hook
 * expose `setAssets` car le composant parent met à jour le state
 * localement après edit/delete/bulk (40+ call sites). Re-fetch en
 * cas de changement de `accountFilter` (URL query param backend).
 */

import { useCallback, useEffect, useState } from "react";
import type { MediaAsset } from "./types";

interface UseMediaAssetsLoaderResult {
  assets: MediaAsset[];
  setAssets: React.Dispatch<React.SetStateAction<MediaAsset[]>>;
  loading: boolean;
  loadError: string | null;
  refetch: () => Promise<void>;
}

type ApiAsset = Omit<MediaAsset, "tags" | "accessAccountIds"> & {
  tags: string;
  accessAccountIds?: string[];
};

function parseAsset(a: ApiAsset): MediaAsset {
  return {
    ...a,
    setTag: (a as unknown as { setTag?: string | null }).setTag ?? null,
    category: (a as unknown as { category?: string | null }).category ?? null,
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
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const url = accountFilter
        ? `/api/admin/libraries/media/${libraryId}/assets?accountId=${encodeURIComponent(accountFilter)}`
        : `/api/admin/libraries/media/${libraryId}/assets`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = (await res.json()) as ApiAsset[];
      setAssets(raw.map(parseAsset));
    } catch (err) {
      console.error("[useMediaAssetsLoader] load error:", err);
      setLoadError(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, [libraryId, accountFilter]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { assets, setAssets, loading, loadError, refetch };
}
