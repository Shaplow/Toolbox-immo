/**
 * Auth des routes API — source unique (V2.1, 17/08).
 *
 * Remplace le boilerplate copié dans ~180 routes (4 variantes de 403 et
 * 5 typos recensées avant l'unification). Aucune magie : chaque helper
 * retourne soit `{ ctx }` (poursuivre), soit `{ response }` (retourner tel
 * quel). Pas de throw — le contrôle de flux reste visible dans la route.
 *
 * ```ts
 * const auth = await requireAdmin();
 * if (auth.response) return auth.response;
 * const { ctx } = auth; // UserContext garanti
 * ```
 *
 * Règles du repo (CLAUDE.md) :
 * - Toujours getUserContext(), jamais auth() — impersonation comprise.
 * - Scope data → ctx.effectiveUser.id ; décision admin → ctx.canAdminBypass ;
 *   audit log → ctx.actualUser.id.
 *
 * Exceptions qui ne passent PAS par ces helpers : /api/admin/impersonation
 * (cookie set/destroy) et /api/webhooks/runpod/* (signés par
 * RUNPOD_WEBHOOK_SECRET).
 */
import { NextResponse } from "next/server";
import { getUserContext, type UserContext } from "@/lib/userContext";

/** Messages uniformisés — uniques points de vérité des 401/403 d'auth. */
export const AUTH_MESSAGES = {
  unauthenticated: "Non autorisé",
  adminOnly: "Réservé aux administrateurs",
} as const;

export type AuthResult =
  | { ctx: UserContext; response?: undefined }
  | { ctx?: undefined; response: NextResponse };

/** 401 si non connecté (effectiveUser absent). */
export async function requireUser(): Promise<AuthResult> {
  const ctx = await getUserContext();
  if (!ctx?.effectiveUser.id) {
    return {
      response: NextResponse.json({ error: AUTH_MESSAGES.unauthenticated }, { status: 401 }),
    };
  }
  return { ctx };
}

/** 401 si non connecté, 403 si non admin (canAdminBypass). */
export async function requireAdmin(): Promise<AuthResult> {
  const auth = await requireUser();
  if (auth.response) return auth;
  if (!auth.ctx.canAdminBypass) {
    return {
      response: NextResponse.json({ error: AUTH_MESSAGES.adminOnly }, { status: 403 }),
    };
  }
  return auth;
}
