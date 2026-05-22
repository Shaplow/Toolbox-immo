/**
 * Matrice rôle → outils accessibles par défaut.
 *
 * ADMIN  — accès à tous les outils (valeur sentinelle "*").
 * CM     — outils utiles pour la phase finale : captions, transcription,
 *           description, cover.
 * MONTEUR — outils de production : captions, transcription.
 * USER   — accès défini individuellement par ses permissions JSON (cf.
 *           User.permissions). La valeur ici est [] : le helper canAccessTool
 *           tombera sur la lecture du JSON permissions.
 *
 * Ces valeurs sont les défauts de rôle. Un USER peut toujours avoir des outils
 * supplémentaires accordés via setUserTools() — canAccessTool() combine les deux.
 */

import type { UserRole } from "@/types/roles";
import type { AppUserIdentity } from "@/lib/userContext";
import { parsePermissions } from "@/lib/userContext";

/** Sentinelle : l'ADMIN a accès à TOUS les outils sans liste explicite. */
export const ROLE_TOOL_SCOPE_ALL = "*" as const;

export type RoleToolScope = typeof ROLE_TOOL_SCOPE_ALL | readonly string[];

export const ROLE_TOOL_SCOPE: Record<UserRole, RoleToolScope> = {
  ADMIN: "*",
  CM: ["captions", "transcription", "description", "cover"] as const,
  MONTEUR: ["captions", "transcription"] as const,
  // USER : pas de set de rôle — accès entièrement dirigé par User.permissions
  USER: [] as const,
};

// ---------------------------------------------------------------------------
// Helper principal
// ---------------------------------------------------------------------------

/**
 * Vérifie si un utilisateur peut accéder à un outil donné.
 *
 * Priorité :
 * 1. ADMIN → toujours true.
 * 2. Rôle MONTEUR ou CM → vrai si toolKey est dans ROLE_TOOL_SCOPE[role].
 * 3. USER (ou fallback) → vrai si toolKey est dans User.permissions (JSON).
 *
 * Cela permet des cumuls ponctuels : un MONTEUR avec "description" dans ses
 * permissions aura aussi accès à description (les deux sources sont ORées).
 */
export function canAccessTool(user: AppUserIdentity, toolKey: string): boolean {
  const role = user.role as UserRole;

  // 1. ADMIN
  if (role === "ADMIN") return true;

  // 2. Vérification via le scope de rôle
  const roleScope = ROLE_TOOL_SCOPE[role] ?? [];
  if (roleScope !== "*" && (roleScope as readonly string[]).includes(toolKey)) {
    return true;
  }

  // 3. Vérification via les permissions individuelles (JSON array)
  const individualTools = parsePermissions(user.permissions);
  return individualTools.includes(toolKey);
}

/**
 * Variante assert : throw si l'utilisateur n'a pas accès à l'outil.
 */
export function assertCanAccessTool(user: AppUserIdentity, toolKey: string): void {
  if (!canAccessTool(user, toolKey)) {
    throw new Error(
      `Accès refusé : le rôle "${user.role}" n'a pas accès à l'outil "${toolKey}".`
    );
  }
}
