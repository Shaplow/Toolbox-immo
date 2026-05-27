/**
 * Helper partagé pour normaliser un rôle brut (String en base) vers UserRole.
 *
 * Centralise la logique auparavant dupliquée dans chaque route API publications
 * et calendar. Valeur inconnue ou absente → "EXTERNAL_GENERATOR" (principe de moindre privilège).
 *
 * @module role
 */
import type { UserRole } from "@/types/roles";
import { USER_ROLES } from "@/types/roles";

/**
 * Normalise un rôle brut vers UserRole.
 *
 * @param raw - La valeur brute du rôle telle que stockée en base (String).
 * @returns Le rôle normalisé, ou "EXTERNAL_GENERATOR" si la valeur est inconnue ou absente.
 */
export function toUserRole(raw?: string | null): UserRole {
  if (raw && Object.hasOwn(USER_ROLES, raw)) return raw as UserRole;
  return "EXTERNAL_GENERATOR";
}
