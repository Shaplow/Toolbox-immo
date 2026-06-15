"use client";

/**
 * CommandPaletteHost — dispatcher de la palette ⌘K selon le rôle.
 *
 * - ADMIN réel → AdminCommandPalette (recherche serveur fuzzy entités +
 *   commandes registry).
 * - Non-admin (MONTEUR / CM / VIDEASTE / EXTERNAL_GENERATOR) → NavCommandPalette
 *   (commandes registry uniquement, pas de fetch /api/admin/search).
 *
 * Le bouton "Rechercher" en sidebar dispatche l'event "palette:open" qui est
 * écouté par les deux composants. Compat ascendante : "admin:open-palette"
 * reste écouté par AdminCommandPalette pour ne pas casser d'éventuels liens.
 *
 * Mount unique dans (app)/layout.tsx pour tous les rôles.
 */

import { AdminCommandPalette } from "./AdminCommandPalette";
import { NavCommandPalette } from "./NavCommandPalette";
import type { CommandUser } from "@/lib/commands/registry";

interface Props {
  user: CommandUser;
}

export function CommandPaletteHost({ user }: Props) {
  if (user.isAdminReal) {
    return <AdminCommandPalette />;
  }
  return <NavCommandPalette user={user} />;
}
