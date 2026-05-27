/**
 * Helpers pour la validation client externe (W2).
 *
 * - Token magic link : génération cryptographically secure, hash sha256 en DB,
 *   comparaison timing-safe. Le rawToken n'est jamais re-stocké après émission.
 * - Resolve config : merge override per-slot + config du pattern (override prime).
 * - TTL : 7 jours par défaut, renouvelable par ADMIN.
 */

import { randomBytes, createHash, timingSafeEqual } from "crypto";
import type { PrismaClient } from "@prisma/client";

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

// ─── Resolve config (pattern + override slot) ─────────────────────────────────

/**
 * Résout une valeur effective override/pattern selon le contrat :
 *  - override !== null/undefined → override prime (source "override")
 *  - sinon pattern existe → valeur du pattern (source "pattern")
 *  - sinon → valeur par défaut (source "default")
 *
 * Helper générique réutilisable pour TOUS les champs `needs*Override` du slot.
 */
export type ResolveSource = "pattern" | "override" | "default";

export function resolveOverride<T>(
  overrideValue: T | null | undefined,
  patternValue: T | null | undefined,
  defaultValue: T,
): { value: T; source: ResolveSource } {
  if (overrideValue !== null && overrideValue !== undefined) {
    return { value: overrideValue, source: "override" };
  }
  if (patternValue !== null && patternValue !== undefined) {
    return { value: patternValue, source: "pattern" };
  }
  return { value: defaultValue, source: "default" };
}

interface PatternForValidation {
  needsClientValidation: boolean;
  allowsClientRevision: boolean;
}

interface SlotForValidation {
  needsClientValidationOverride: boolean | null;
  allowsClientRevisionOverride: boolean | null;
}

export interface ClientValidationConfig {
  /** True si ce slot doit passer par une validation client externe. */
  needsClientValidation: boolean;
  /** True si le client peut refuser avec commentaire (ping-pong autorisé). */
  allowsClientRevision: boolean;
  /**
   * Pour debug/UI : indique d'où chaque valeur vient.
   * - "pattern" : valeur héritée du pattern
   * - "override" : valeur surchargée au niveau du slot
   * - "default" : pas de pattern (slot orphelin), valeur false par défaut
   */
  source: {
    needsClientValidation: ResolveSource;
    allowsClientRevision: ResolveSource;
  };
}

/**
 * Calcule la config effective de validation client pour un slot.
 * Override per-slot prime sur la config du pattern.
 *
 * Règle : null = hérite ; true/false = écrase explicitement.
 */
export function resolveClientValidationConfig(
  slot: SlotForValidation,
  pattern: PatternForValidation | null,
): ClientValidationConfig {
  const needs = resolveOverride(
    slot.needsClientValidationOverride,
    pattern?.needsClientValidation,
    false,
  );
  const allows = resolveOverride(
    slot.allowsClientRevisionOverride,
    pattern?.allowsClientRevision,
    false,
  );
  return {
    needsClientValidation: needs.value,
    allowsClientRevision: allows.value,
    source: {
      needsClientValidation: needs.source,
      allowsClientRevision: allows.source,
    },
  };
}

// ─── Resolve étendu pour tous les needs* (Cohérence Workflows Phase 4) ────────

interface SlotForAllOverrides {
  needsClientValidationOverride: boolean | null;
  allowsClientRevisionOverride: boolean | null;
  needsCaptionsOverride: boolean | null;
  needsDescriptionOverride: string | null;
  needsRushesOverride: boolean | null;
  needsBriefOverride: boolean | null;
  // Phase 5 — overrides one-off (référence directe aux ressources)
  coverModeOverride?: string | null;
  coverPresetIdOverride?: string | null;
  captionPresetIdOverride?: string | null;
  descriptionPromptIdOverride?: string | null;
}

interface PatternForAllNeeds {
  needsClientValidation: boolean;
  allowsClientRevision: boolean;
  needsCaptions: boolean;
  needsDescription: string;
  needsRushes: boolean;
  needsBrief: boolean;
  // Phase 5 — valeurs héritées pour les overrides one-off
  coverMode?: string;
  /** coverConfig contient le coverPresetId (Phase 3) — passé en string nullable. */
  coverPresetId?: string | null;
  captionPresetId?: string | null;
  descriptionPromptId?: string | null;
}

/**
 * Config résolue exhaustive des `needs*` (et `allows*`) pour un slot.
 * Inclut la source de chaque valeur (pattern/override/default) pour permettre
 * à l'UI d'indiquer "ce champ est surchargé".
 */
export interface SlotResolvedConfig {
  needsClientValidation: boolean;
  allowsClientRevision: boolean;
  needsCaptions: boolean;
  needsDescription: string;
  needsRushes: boolean;
  needsBrief: boolean;
  // Phase 5 — config one-off résolue (référence aux ressources)
  coverMode: string;
  coverPresetId: string | null;
  captionPresetId: string | null;
  descriptionPromptId: string | null;
  source: {
    needsClientValidation: ResolveSource;
    allowsClientRevision: ResolveSource;
    needsCaptions: ResolveSource;
    needsDescription: ResolveSource;
    needsRushes: ResolveSource;
    needsBrief: ResolveSource;
    coverMode: ResolveSource;
    coverPresetId: ResolveSource;
    captionPresetId: ResolveSource;
    descriptionPromptId: ResolveSource;
  };
}

/**
 * Calcule la config effective d'un slot pour tous les `needs*` (et `allows*`),
 * en appliquant les overrides per-slot par-dessus la config du pattern.
 *
 * Utilisé par : computePublicationSteps (page.tsx fiche), triggerAutoCaption,
 * SlotDetailPanel (lecture seule pour afficher les valeurs effectives).
 */
export function resolveSlotConfig(
  slot: SlotForAllOverrides,
  pattern: PatternForAllNeeds | null,
): SlotResolvedConfig {
  const ncv = resolveOverride(slot.needsClientValidationOverride, pattern?.needsClientValidation, false);
  const acr = resolveOverride(slot.allowsClientRevisionOverride, pattern?.allowsClientRevision, false);
  const nc = resolveOverride(slot.needsCaptionsOverride, pattern?.needsCaptions, false);
  const nd = resolveOverride(slot.needsDescriptionOverride, pattern?.needsDescription, "none");
  const nr = resolveOverride(slot.needsRushesOverride, pattern?.needsRushes, false);
  const nb = resolveOverride(slot.needsBriefOverride, pattern?.needsBrief, false);
  // Phase 5 — overrides one-off
  const cm = resolveOverride(slot.coverModeOverride, pattern?.coverMode, "none");
  const cpId = resolveOverride(slot.coverPresetIdOverride, pattern?.coverPresetId, null);
  const captPId = resolveOverride(slot.captionPresetIdOverride, pattern?.captionPresetId, null);
  const descPId = resolveOverride(slot.descriptionPromptIdOverride, pattern?.descriptionPromptId, null);
  return {
    needsClientValidation: ncv.value,
    allowsClientRevision: acr.value,
    needsCaptions: nc.value,
    needsDescription: nd.value,
    needsRushes: nr.value,
    needsBrief: nb.value,
    coverMode: cm.value,
    coverPresetId: cpId.value,
    captionPresetId: captPId.value,
    descriptionPromptId: descPId.value,
    source: {
      needsClientValidation: ncv.source,
      allowsClientRevision: acr.source,
      needsCaptions: nc.source,
      needsDescription: nd.source,
      needsRushes: nr.source,
      needsBrief: nb.source,
      coverMode: cm.source,
      coverPresetId: cpId.source,
      captionPresetId: captPId.source,
      descriptionPromptId: descPId.source,
    },
  };
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
