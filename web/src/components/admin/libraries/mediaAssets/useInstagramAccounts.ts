"use client";

/**
 * useInstagramAccounts — fetch unique des comptes Instagram pour les
 * pickers d'access asset (settings.accessAccountIds) et le filtre par
 * compte de la vue rotation.
 *
 * Première brique du split C1-v2 §19. Pas de paramètre.
 *
 * Tape sur `/api/admin/libraries/media/accounts` (gate `canManageMediaAssets`,
 * ADMIN + VIDEASTE) et NON `/api/admin/accounts` (ADMIN-only via `canAdminBypass`).
 * Avant ce repointage, un VIDEASTE recevait un 403 → liste vide → toute la
 * dimension « compte » (filtre « Tous les comptes », édition d'accès, upload)
 * disparaissait silencieusement alors qu'il a bien les droits asset-level.
 */

import { useEffect, useState } from "react";
import type { InstagramAccount } from "./types";

export function useInstagramAccounts(): InstagramAccount[] {
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);

  useEffect(() => {
    fetch("/api/admin/libraries/media/accounts")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: unknown) => setAccounts(data as InstagramAccount[]))
      .catch((err: unknown) => {
        // Le panel reste fonctionnel sans la liste des comptes (pickers vides),
        // mais on log pour éviter une disparition opaque de features à l'avenir.
        console.warn("[useInstagramAccounts] chargement des comptes échoué:", err);
      });
  }, []);

  return accounts;
}
