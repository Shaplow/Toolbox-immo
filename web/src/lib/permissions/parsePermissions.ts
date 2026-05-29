/**
 * Helper neutre (client + server) pour parser le champ `permissions` stocké
 * en string JSON sur User.
 *
 * Centralise la logique auparavant dupliquée dans plusieurs endroits :
 * - AppNav.tsx (JSON.parse inline)
 * - lib/permissions/tools.ts (canAccessTool)
 * - lib/userContext.ts (déclaration historique)
 *
 * Tolérant aux entrées malformées : retourne `[]` si parse échoue ou si
 * `rawPermissions` est null/undefined.
 *
 * Ce fichier est séparé pour rester importable côté client. Le module
 * `lib/userContext` touche `cookies()` / `auth()` (server-only) et ne peut
 * pas être importé depuis un Client Component.
 */

export function parsePermissions(rawPermissions: string | null | undefined): string[] {
  try {
    return JSON.parse(rawPermissions ?? "[]") as string[];
  } catch {
    return [];
  }
}
