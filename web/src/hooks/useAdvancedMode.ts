"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY_PREFIX = "toolbox_mediatheque_advanced_";

/**
 * Persist "Réglages avancés" toggle per library in localStorage.
 * Default OFF (noob mode). Quand ON, l'UI restaure view-mode switcher,
 * filtre tag, édition inline, simulation rotation.
 */
export function useAdvancedMode(libId: string): {
  isAdvanced: boolean;
  toggleAdvanced: () => void;
  setAdvanced: (next: boolean) => void;
} {
  const [isAdvanced, setIsAdvanced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(STORAGE_KEY_PREFIX + libId);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored === "true") setIsAdvanced(true);
    else setIsAdvanced(false);
  }, [libId]);

  const setAdvanced = useCallback(
    (next: boolean) => {
      setIsAdvanced(next);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY_PREFIX + libId, String(next));
      }
    },
    [libId],
  );

  const toggleAdvanced = useCallback(() => {
    setAdvanced(!isAdvanced);
  }, [isAdvanced, setAdvanced]);

  return { isAdvanced, toggleAdvanced, setAdvanced };
}
