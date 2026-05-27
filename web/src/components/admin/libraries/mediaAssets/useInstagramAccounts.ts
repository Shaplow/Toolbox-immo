"use client";

/**
 * useInstagramAccounts — fetch unique des comptes Instagram pour les
 * pickers d'access asset (settings.accessAccountIds) et le filtre par
 * compte de la vue rotation.
 *
 * Première brique du split C1-v2 §19. Pas de paramètre, fail-silent.
 */

import { useEffect, useState } from "react";
import type { InstagramAccount } from "./types";

export function useInstagramAccounts(): InstagramAccount[] {
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);

  useEffect(() => {
    fetch("/api/admin/accounts")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: unknown) => setAccounts(data as InstagramAccount[]))
      .catch(() => {
        // Silent : le panel reste fonctionnel sans la liste des comptes
        // (les pickers afficheront juste vide).
      });
  }, []);

  return accounts;
}
