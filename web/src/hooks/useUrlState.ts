"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Hook générique qui lit / écrit une clé dans la query string.
 *
 * - Retourne la valeur courante (raw string) ou `null` si absente.
 * - `setValue(null)` ou `setValue("")` supprime la clé.
 * - Par défaut utilise `router.replace` (pas de push history) — l'admin peut
 *   browser-back depuis une autre page sans repasser par tous les filtres.
 * - `scroll: false` pour ne pas remonter la page à chaque write.
 *
 * Usage :
 *   const [accountId, setAccountId] = useUrlState("accountId", "");
 *   setAccountId("abc123");        // ?accountId=abc123
 *   setAccountId("");              // supprime ?accountId
 */
export function useUrlState(
  key: string,
  defaultValue: string = "",
  options?: { mode?: "replace" | "push" },
) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const mode = options?.mode ?? "replace";

  const raw = searchParams?.get(key) ?? null;
  const value = raw ?? defaultValue;

  const setValue = useCallback(
    (next: string | null) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      if (next === null || next === "" || next === defaultValue) {
        params.delete(key);
      } else {
        params.set(key, next);
      }
      const qs = params.toString();
      const base = pathname ?? "/";
      const url = qs ? `${base}?${qs}` : base;
      if (mode === "push") router.push(url, { scroll: false });
      else router.replace(url, { scroll: false });
    },
    [key, defaultValue, searchParams, pathname, router, mode],
  );

  return [value, setValue] as const;
}

/**
 * Variante pour bool : présent = true, absent = false. Pratique pour les
 * toggles tels que `?onlyMine=true`.
 */
export function useUrlBool(key: string) {
  const [raw, setRaw] = useUrlState(key, "");
  const value = raw === "true" || raw === "1";
  const setValue = useCallback(
    (next: boolean) => setRaw(next ? "true" : null),
    [setRaw],
  );
  return [value, setValue] as const;
}

/**
 * Helper pur (testable) : reconstruit l'URL après une mutation de clé.
 * Utilisé en interne par useUrlState, exporté pour les tests vitest.
 */
export function buildUrl(
  pathname: string,
  currentSearch: string,
  key: string,
  next: string | null,
  defaultValue: string = "",
): string {
  const params = new URLSearchParams(currentSearch);
  if (next === null || next === "" || next === defaultValue) {
    params.delete(key);
  } else {
    params.set(key, next);
  }
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
