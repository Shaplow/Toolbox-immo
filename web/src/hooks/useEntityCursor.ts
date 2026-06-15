"use client";

import { useCallback, useMemo } from "react";

interface Identifiable {
  id: string;
}

/**
 * Hook curseur prev/next pour naviguer entre entités d'une liste filtrée
 * sans fermer/rouvrir une fiche/drawer.
 *
 * - `list` : tableau ordonné des entités (ex. slots filtrés du calendrier).
 * - `currentId` : l'id de l'entité actuellement ouverte.
 * - `setCurrentId` : callback pour ouvrir une autre entité (typiquement
 *   un setter URL state qui change `?slot=<id>`).
 *
 * Retourne :
 *  - `index` / `total`
 *  - `hasNext` / `hasPrev`
 *  - `next()` / `prev()` : actions à câbler sur les boutons ou raccourcis
 *
 * Usage :
 *   const [slotId, setSlotId] = useUrlState("slot", "");
 *   const cursor = useEntityCursor(slots, slotId, setSlotId);
 *   cursor.next();  // ouvre le slot suivant dans la liste filtrée
 */
export function useEntityCursor<T extends Identifiable>(
  list: T[],
  currentId: string | null,
  setCurrentId: (next: string | null) => void,
) {
  const index = useMemo(() => {
    if (!currentId) return -1;
    return list.findIndex((item) => item.id === currentId);
  }, [list, currentId]);

  const total = list.length;
  const hasNext = index >= 0 && index < total - 1;
  const hasPrev = index > 0;
  const current = index >= 0 ? list[index] : null;

  const next = useCallback(() => {
    if (hasNext) setCurrentId(list[index + 1].id);
  }, [hasNext, index, list, setCurrentId]);

  const prev = useCallback(() => {
    if (hasPrev) setCurrentId(list[index - 1].id);
  }, [hasPrev, index, list, setCurrentId]);

  return { current, index, total, hasNext, hasPrev, next, prev };
}

/**
 * Helper pur (testable) : calcule next/prev index depuis une liste d'ids.
 * Exporté pour vitest.
 */
export function computeCursor(
  ids: string[],
  currentId: string | null,
): { index: number; total: number; hasNext: boolean; hasPrev: boolean } {
  const total = ids.length;
  if (!currentId) {
    return { index: -1, total, hasNext: false, hasPrev: false };
  }
  const index = ids.indexOf(currentId);
  return {
    index,
    total,
    hasNext: index >= 0 && index < total - 1,
    hasPrev: index > 0,
  };
}
