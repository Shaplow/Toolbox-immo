/**
 * Garde commune des routes publiques /api/export/[token]/* : limite de débit
 * par IP, puis vérification du jeton. Toute raison d'échec (inconnu, expiré,
 * révoqué) donne le même 404 : rien à énumérer.
 */

import { NextResponse } from "next/server";
import { createRateLimiter, getClientIp } from "@/lib/http/rateLimit";
import { verifyExportToken, type VerifiedExportLink } from "./exportLinks";

export const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

export type PublicExportGuardResult =
  | { link: VerifiedExportLink; response?: undefined }
  | { link?: undefined; response: NextResponse };

export function createPublicExportGuard(limit: { windowMs: number; max: number }) {
  const limiter = createRateLimiter(limit);
  return async function guard(req: Request, rawToken: string): Promise<PublicExportGuardResult> {
    if (!limiter.check(getClientIp(req))) {
      return {
        response: NextResponse.json(
          { error: "Trop de requêtes, réessaie dans une minute." },
          { status: 429, headers: { ...NO_STORE_HEADERS, "Retry-After": "60" } },
        ),
      };
    }
    const verification = await verifyExportToken(rawToken);
    if (!verification.valid) {
      return {
        response: NextResponse.json(
          { error: "Lien invalide ou expiré" },
          { status: 404, headers: NO_STORE_HEADERS },
        ),
      };
    }
    return { link: verification.link };
  };
}
