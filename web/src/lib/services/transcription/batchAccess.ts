/**
 * batchAccess — garde commune des routes /api/transcription/batches/*.
 *
 * Les routes de lot exigent l'outil Transcription (comme le prepare POST
 * /api/transcription) et ne lisent que les jobs de `effectiveUser` : un lot
 * n'existe que par ses jobs, toujours filtrés par `userId` (impersonation
 * comprise). Pas de bypass admin vers les lots d'un autre utilisateur — l'outil
 * ne les affiche jamais ; un admin passe par l'impersonation.
 */

import { NextResponse } from "next/server";
import { requireUser, type AuthResult } from "@/lib/api/requireAuth";
import { hasTool, TOOLS } from "@/lib/permissions";
import { isValidBatchId } from "@/lib/transcription/batches";

export async function requireTranscriptionUser(): Promise<AuthResult> {
  const auth = await requireUser();
  if (auth.response) return auth;
  const { ctx } = auth;
  if (!ctx.canAdminBypass && !(await hasTool(ctx.effectiveUser.id, TOOLS.TRANSCRIPTION))) {
    return { response: NextResponse.json({ error: "Accès refusé" }, { status: 403 }) };
  }
  return auth;
}

/** Normalise le batchId de l'URL ; null s'il n'a pas la forme d'un UUID. */
export function parseBatchIdParam(raw: string): string | null {
  return isValidBatchId(raw) ? raw.toLowerCase() : null;
}

export function batchNotFound(): NextResponse {
  return NextResponse.json({ error: "Lot introuvable" }, { status: 404 });
}
