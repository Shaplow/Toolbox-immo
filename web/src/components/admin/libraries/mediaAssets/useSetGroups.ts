"use client";

/**
 * useSetGroups — regroupe les assets filtrés par `setTag` (vue "Dossiers").
 * Extrait de MediaAssetsPanel (split C1-v2). Le tirage réel (LRU par
 * dossier) est géré côté serveur — ce hook produit une grille de rangement,
 * pas une preview d'ordre de tirage.
 */

import { useMemo } from "react";
import type { MediaAsset, SetGroup } from "./types";

export function useSetGroups(filtered: MediaAsset[], accountFilter: string | null): SetGroup[] {
  return useMemo(() => {
    const groups = new Map<string, MediaAsset[]>();
    filtered.forEach((a) => {
      const key = a.setTag ?? "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(a);
    });

    // Only use assets accessible to the filtered account when computing last-used date.
    const getLastUsed = (groupAssets: MediaAsset[]) => {
      const pool = accountFilter
        ? groupAssets.filter((a) => a.accessAccountIds.length === 0 || a.accessAccountIds.includes(accountFilter))
        : groupAssets;
      return pool.reduce<string | null>((max, a) => {
        if (!a.lastUsedAt) return max;
        if (!max) return a.lastUsedAt;
        return a.lastUsedAt > max ? a.lastUsedAt : max;
      }, null);
    };

    const allEntries: SetGroup[] = Array.from(groups.entries()).map(([key, groupAssets]) => {
      const setTag = key || null;
      const isAccessible = !accountFilter || groupAssets.some(
        (a) => !a.disabled && (a.accessAccountIds.length === 0 || a.accessAccountIds.includes(accountFilter))
      );
      const accessibleCount = accountFilter
        ? groupAssets.filter((a) => !a.disabled && (a.accessAccountIds.length === 0 || a.accessAccountIds.includes(accountFilter))).length
        : groupAssets.filter((a) => !a.disabled).length;
      return {
        key: key || "__none__",
        setTag,
        groupAssets,
        accessibleCount,
        lastUsed: getLastUsed(groupAssets),
        isAccessible,
      };
    });

    const named = allEntries.filter((g) => g.setTag);
    const unnamed = allEntries.filter((g) => !g.setTag);

    // Tri alphabétique numeric-aware sur setTag (parité avec le LPAD SQL du
    // resolver serveur) — le bucket « sans dossier » reste toujours en dernier.
    const tiebreakSetTag = (a: SetGroup, b: SetGroup): number => {
      const na = parseInt(a.setTag ?? "", 10);
      const nb = parseInt(b.setTag ?? "", 10);
      if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
      return (a.setTag ?? "").localeCompare(b.setTag ?? "");
    };
    const sortedNamed = [...named].sort(tiebreakSetTag);

    // En filtre par compte, on masque les dossiers inaccessibles.
    if (accountFilter) {
      const visibleNamed = sortedNamed.filter((g) => g.isAccessible);
      const visibleUnnamed = unnamed.filter((g) => g.isAccessible);
      return [...visibleNamed, ...visibleUnnamed];
    }
    return [...sortedNamed, ...unnamed];
  }, [filtered, accountFilter]);
}
