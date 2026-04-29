"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Generic interval-based job polling hook.
 *
 * - Calls `fetchFn` every `intervalMs` ms while `enabled` is true.
 * - Automatically stops the interval once `isTerminal(data)` returns true.
 * - `fetchFn` and `isTerminal` are read from stable refs so inline arrows
 *   don't cause interval restarts on each render.
 *
 * @example
 * const { data } = useJobPolling<JobDetail>({
 *   fetchFn: () => fetch(`/api/transcription/${id}`).then(r => r.json()),
 *   isTerminal: (d) => d.status === "COMPLETED" || d.status === "FAILED",
 *   intervalMs: 5000,
 *   enabled: job.status !== "COMPLETED" && job.status !== "FAILED",
 * });
 */
export function useJobPolling<T>({
  fetchFn,
  isTerminal,
  intervalMs,
  enabled = true,
}: {
  fetchFn: () => Promise<T>;
  isTerminal: (data: T) => boolean;
  intervalMs: number;
  enabled?: boolean;
}): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Stable refs — interval callback always uses the latest functions without
  // needing them in the dependency array (which would restart the interval).
  const fetchFnRef = useRef(fetchFn);
  useEffect(() => { fetchFnRef.current = fetchFn; });
  const isTerminalRef = useRef(isTerminal);
  useEffect(() => { isTerminalRef.current = isTerminal; });

  // Survive re-renders: track whether we already reached a terminal state so
  // we don't restart the interval if `enabled` briefly flips back to true.
  const terminalRef = useRef(false);

  useEffect(() => {
    if (!enabled || terminalRef.current) return;

    const id = window.setInterval(async () => {
      try {
        const result = await fetchFnRef.current();
        setData(result);
        setError(null);
        if (isTerminalRef.current(result)) {
          terminalRef.current = true;
          window.clearInterval(id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }, intervalMs);

    return () => window.clearInterval(id);
  }, [enabled, intervalMs]);

  return { data, error };
}
