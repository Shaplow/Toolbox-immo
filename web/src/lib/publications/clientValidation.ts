/**
 * Helpers pour la validation client externe (W2) — tokens magic link uniquement.
 *
 * - Token magic link : génération cryptographically secure, hash sha256 en DB,
 *   comparaison timing-safe. Le rawToken n'est jamais re-stocké après émission.
 * - TTL : 7 jours par défaut, renouvelable par ADMIN.
 *
 * Les helpers `resolveOverride`, `resolveClientValidationConfig`, `resolveSlotConfig`
 * vivent désormais dans `@/lib/services/slot/config`. Ce module les re-export
 * pour préserver les imports existants pendant la phase de migration (S1).
 * Les imports directs depuis `@/lib/services/slot/config` sont à privilégier.
 */

import { randomBytes, createHash, timingSafeEqual } from "crypto";
import type { PrismaClient } from "@prisma/client";

// Re-exports — le code source vit dans services/slot/config.ts (S1.2)
export {
  resolveOverride,
  resolveClientValidationConfig,
  resolveSlotConfig,
} from "@/lib/services/slot/config";
export type {
  ResolveSource,
  ClientValidationConfig,
  SlotResolvedConfig,
} from "@/lib/services/slot/config";

// ─── Constantes ────────────────────────────────────────────────────────────────

/** Durée par défaut de validité d'un magic link (7 jours). */
export const CLIENT_VALIDATION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Longueur du rawToken (en bytes random). 32 bytes = 256 bits = très collision-safe. */
const TOKEN_BYTES = 32;

// ─── Hash + lookup ─────────────────────────────────────────────────────────────

/** sha256 hex d'une chaîne. Utilisé pour stocker un token sans exposer le raw. */
export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Compare deux hash de manière timing-safe (résistant aux attaques timing).
 * Les deux paramètres doivent être de même longueur (sinon false sans erreur).
 */
export function compareHashes(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

// ─── Token génération / révocation ────────────────────────────────────────────

/**
 * Génère un nouveau token magic link pour un slot.
 *
 * - Révoque tous les tokens actifs précédents du slot (un seul actif à la fois).
 * - Crée un nouveau token avec expiresAt = now + TTL.
 * - Retourne le rawToken (à inclure dans l'URL) — il ne sera plus jamais lisible
 *   après cette fonction puisqu'on ne stocke que son hash.
 *
 * @returns { rawToken, tokenId, expiresAt }
 */
export async function generateClientValidationToken(
  prisma: PrismaClient,
  params: {
    slotId: string;
    createdByUserId: string;
    ttlMs?: number;
  },
): Promise<{ rawToken: string; tokenId: string; expiresAt: Date }> {
  const ttl = params.ttlMs ?? CLIENT_VALIDATION_TOKEN_TTL_MS;

  // Révoquer les tokens actifs existants (en transaction pour atomicité).
  return await prisma.$transaction(async (tx) => {
    await tx.clientValidationToken.updateMany({
      where: { slotId: params.slotId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const rawToken = randomBytes(TOKEN_BYTES).toString("hex");
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + ttl);

    const created = await tx.clientValidationToken.create({
      data: {
        slotId: params.slotId,
        tokenHash,
        expiresAt,
        createdByUserId: params.createdByUserId,
      },
      select: { id: true },
    });

    return { rawToken, tokenId: created.id, expiresAt };
  });
}

/**
 * Révoque tous les tokens actifs d'un slot. Idempotent.
 *
 * @returns Nombre de tokens révoqués (0 si aucun actif).
 */
export async function revokeClientValidationTokens(
  prisma: PrismaClient,
  slotId: string,
): Promise<number> {
  const result = await prisma.clientValidationToken.updateMany({
    where: { slotId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

// ─── Validation du token (côté page publique) ─────────────────────────────────

export type TokenValidationResult =
  | { valid: true; slotId: string; tokenId: string }
  | { valid: false; reason: "not_found" | "expired" | "revoked" };

/**
 * Vérifie un rawToken et retourne le slotId associé si valide.
 * Distingue les raisons d'échec pour permettre des messages d'erreur précis
 * (mais l'UI doit afficher un 404 générique pour anti-énumération).
 */
export async function verifyClientValidationToken(
  prisma: PrismaClient,
  rawToken: string,
): Promise<TokenValidationResult> {
  if (!rawToken || rawToken.length < 8) {
    return { valid: false, reason: "not_found" };
  }

  const tokenHash = hashToken(rawToken);
  const record = await prisma.clientValidationToken.findUnique({
    where: { tokenHash },
    select: { id: true, slotId: true, expiresAt: true, revokedAt: true },
  });

  if (!record) return { valid: false, reason: "not_found" };
  if (record.revokedAt !== null) return { valid: false, reason: "revoked" };
  if (record.expiresAt.getTime() < Date.now()) return { valid: false, reason: "expired" };

  return { valid: true, slotId: record.slotId, tokenId: record.id };
}
