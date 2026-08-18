"use client";

import { useEffect, useRef, useState } from "react";

interface UseFetchOnOpenOptions {
  onError?: (err: unknown) => void;
}

interface UseFetchOnOpenResult<T> {
  data: T | null;
  loading: boolean;
  error: unknown;
}

/**
 * Hook générique pour les peek drawers (et motifs similaires) : charge `url`
 * quand `open` passe à true, réinitialise `data` à la fermeture ou quand
 * `url` change, et annule un fetch en vol si le composant se démonte ou si
 * `open`/`url` changent avant la résolution (flag `cancelled`, pas
 * d'AbortController — aligné sur le pattern existant des peek drawers).
 *
 * `url` null désactive le fetch (ex. id pas encore résolu) sans erreur — le
 * hook retombe simplement en état vide, comme `!accountId` avant.
 */
export function useFetchOnOpen<T>(
  url: string | null,
  open: boolean,
  options?: UseFetchOnOpenOptions,
): UseFetchOnOpenResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const onErrorRef = useRef(options?.onError);
  onErrorRef.current = options?.onError;

  useEffect(() => {
    if (!open || !url) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Erreur ${res.status}`);
        }
        const payload = (await res.json()) as T;
        if (!cancelled) setData(payload);
      } catch (err) {
        if (!cancelled) {
          setError(err);
          onErrorRef.current?.(err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, open]);

  return { data, loading, error };
}
