"use client";

import { useState, useEffect, useCallback } from "react";

type WorklistCountState = {
  count: number;
  isLoading: boolean;
  error: string | null;
};

const REFETCH_INTERVAL_MS = 60_000; // revalide toutes les 60 secondes

/**
 * Retourne le nombre de publications actives concernant l'utilisateur courant.
 *
 * - Fetche GET /api/worklist/count au mount.
 * - Revalide toutes les 60 secondes via setInterval.
 * - Revalide au retour sur l'onglet via window.focus.
 * - Cleanup propre des listeners et intervals.
 *
 * Pas de SWR dans ce repo — hook natif useState + useEffect.
 */
export function useWorklistCount(): WorklistCountState {
  const [count, setCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCount = useCallback(async () => {
    try {
      const res = await fetch("/api/worklist/count", { cache: "no-store" });
      if (!res.ok) {
        // 403 pour USER — count reste à 0, pas d'erreur visible
        if (res.status === 403) {
          setCount(0);
          setError(null);
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as { count: number };
      setCount(data.count ?? 0);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCount();

    const interval = setInterval(() => {
      void fetchCount();
    }, REFETCH_INTERVAL_MS);

    const handleFocus = () => {
      void fetchCount();
    };
    window.addEventListener("focus", handleFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
    };
  }, [fetchCount]);

  return { count, isLoading, error };
}
