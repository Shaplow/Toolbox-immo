"use client";

/**
 * useInfiniteScroll — fenêtre de rendu progressive (48 par page) + sentinel
 * IntersectionObserver pour la grille/liste MediaAssets. Extrait de
 * MediaAssetsPanel (split C1-v2).
 *
 * `resetDeps` reproduit le tableau de dépendances du caller (ex :
 * search/sort/tagFilter/accountFilter/library.id) : tout changement dans ce
 * tableau remet `visibleCount` à 48, comme dans le panel avant extraction.
 */

import { useEffect, useRef, useState } from "react";
import type { DependencyList } from "react";

interface UseInfiniteScrollResult {
  visibleCount: number;
  /** Callback ref à poser sur le nœud sentinel (grille ou liste). L'observer
   *  se (re)lance dès que le nœud se monte réellement — robuste au switch de
   *  vue et au passage « 0 résultat » → N. */
  setGridSentinel: (node: HTMLDivElement | null) => void;
}

export function useInfiniteScroll(
  filteredLength: number,
  resetDeps: DependencyList,
): UseInfiniteScrollResult {
  const [visibleCount, setVisibleCount] = useState(48);
  // Refs stables pour le sentinel (lues par l'observer, mises à jour via effet
  // — React 19 strict mode interdit `ref.current = ...` dans le corps du composant).
  const visibleCountRef = useRef(0);
  const filteredLengthRef = useRef(0);
  // Sentinel stocké en state via callback ref : voir commentaire au call site
  // historique — un observer posé au montage sur un nœud encore null ne se
  // rattache jamais. Le callback ref (setter useState, stable) corrige ça.
  const [gridSentinel, setGridSentinel] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    visibleCountRef.current = visibleCount;
    filteredLengthRef.current = filteredLength;
  }, [visibleCount, filteredLength]);

  // Reset visible count quand les filtres/tri/bibliothèque/compte changent
  // (pattern "reset state when external data changes" — React docs OK).
  useEffect(() => {
    setVisibleCount(48);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, resetDeps);

  useEffect(() => {
    if (!gridSentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && visibleCountRef.current < filteredLengthRef.current) {
          setVisibleCount((n) => n + 48);
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(gridSentinel);
    return () => observer.disconnect();
  }, [gridSentinel]);

  return { visibleCount, setGridSentinel };
}
