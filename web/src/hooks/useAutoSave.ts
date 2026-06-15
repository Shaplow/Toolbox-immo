"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export type AutoSaveStatus = "idle" | "saving" | "saved" | "error";

interface Options {
  /** Debounce avant flush (default 800ms). */
  debounceMs?: number;
  /** Nombre max de retry sur erreur réseau (default 2). */
  maxRetries?: number;
  /** Délai en ms avant que le status "saved" repasse à "idle" (default 2500ms). */
  savedClearMs?: number;
}

/**
 * Hook auto-save inline avec debounce + queue séquentielle.
 *
 * Pattern :
 *  - L'utilisateur tape dans un champ → enqueue({ field: value }) à chaque keystroke.
 *  - Les patches s'accumulent dans une fenêtre de debounce (default 800ms).
 *  - Quand la fenêtre se ferme, le patch mergé part en queue.
 *  - La queue est traitée **séquentiellement** (await chaîné) — pas en parallèle —
 *    pour éviter les race conditions où un save B revient avant un save A.
 *  - Retry réseau (default 2) avec backoff linéaire.
 *  - Status : `idle | saving | saved | error` affiché dans le drawer.
 *
 * Usage :
 *   const { status, savedAt, error, enqueue, flush } = useAutoSave<SlotPatch>(
 *     async (patch) => {
 *       const res = await fetch(`/api/calendar/slots/${id}`, {
 *         method: "PATCH",
 *         body: JSON.stringify(patch),
 *       });
 *       if (!res.ok) throw new Error(`Erreur ${res.status}`);
 *     }
 *   );
 *   <input onChange={(e) => enqueue({ notes: e.target.value })} />
 *
 * Important : pour les transitions de statut (qui doivent rester atomiques
 * avec d'autres changements), utiliser `flush()` après le setter de statut
 * pour forcer un save immédiat avec tous les pending writes.
 */
export function useAutoSave<T extends Record<string, unknown>>(
  saveFn: (patch: Partial<T>) => Promise<void>,
  options?: Options,
) {
  const debounceMs = options?.debounceMs ?? 800;
  const maxRetries = options?.maxRetries ?? 2;
  const savedClearMs = options?.savedClearMs ?? 2500;

  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Pending writes accumulés dans la fenêtre de debounce courante.
  const pendingRef = useRef<Partial<T>>({});
  // Timer du debounce.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Queue de patches à envoyer séquentiellement.
  const queueRef = useRef<Array<Partial<T>>>([]);
  // Empêche deux processQueue en parallèle.
  const processingRef = useRef(false);
  // Garde la dernière saveFn fraîche sans re-créer enqueue à chaque rerender.
  const saveFnRef = useRef(saveFn);
  useLayoutEffect(() => {
    saveFnRef.current = saveFn;
  }, [saveFn]);

  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    if (queueRef.current.length === 0) return;
    processingRef.current = true;
    setStatus("saving");
    setError(null);

    while (queueRef.current.length > 0) {
      const patch = queueRef.current.shift()!;
      let attempts = 0;
      let succeeded = false;
      while (attempts <= maxRetries && !succeeded) {
        try {
          await saveFnRef.current(patch);
          succeeded = true;
        } catch (err) {
          attempts += 1;
          if (attempts > maxRetries) {
            setStatus("error");
            setError(err instanceof Error ? err.message : "Erreur");
            processingRef.current = false;
            return;
          }
          await new Promise((r) => setTimeout(r, 200 * attempts));
        }
      }
    }

    setStatus("saved");
    setSavedAt(Date.now());
    processingRef.current = false;
  }, [maxRetries]);

  const enqueue = useCallback(
    (patch: Partial<T>) => {
      pendingRef.current = { ...pendingRef.current, ...patch };
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const merged = pendingRef.current;
        pendingRef.current = {};
        timerRef.current = null;
        if (Object.keys(merged).length === 0) return;
        queueRef.current.push(merged);
        void processQueue();
      }, debounceMs);
    },
    [debounceMs, processQueue],
  );

  /**
   * Force flush immédiat des pending writes (sans attendre la fin du debounce).
   * À appeler avant un changement de statut ou avant la fermeture du drawer.
   */
  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (Object.keys(pendingRef.current).length > 0) {
      const merged = pendingRef.current;
      pendingRef.current = {};
      queueRef.current.push(merged);
    }
    await processQueue();
  }, [processQueue]);

  // Auto-clear "saved" status après savedClearMs pour éviter d'afficher
  // "Sauvegardé il y a 12 min" indéfiniment.
  useEffect(() => {
    if (status !== "saved") return;
    const t = setTimeout(() => {
      setStatus("idle");
    }, savedClearMs);
    return () => clearTimeout(t);
  }, [status, savedAt, savedClearMs]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { status, savedAt, error, enqueue, flush };
}
