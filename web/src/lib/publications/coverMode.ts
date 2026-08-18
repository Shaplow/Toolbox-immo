/**
 * Cover mode — source de vérité unique pour les valeurs enum, le parsing de
 * `Pattern.coverConfig` (champ JSON opaque) et la résolution du
 * TemplateCoverPreset effectif pour un slot.
 *
 * Avant la consolidation : `VALID_COVER_MODES` était dupliqué dans 2 routes
 * patterns admin + comparaison `=== "auto"` (valeur jamais atteinte, dead
 * guard) dans slotService.createSlot/patchSlot. La cascade de résolution du
 * preset (id → nom → défaut du template) était répliquée verbatim dans 3
 * lieux avec 3 guards subtilement différents — dont un (autoCoverTrigger.ts)
 * sans le fallback « défaut du template », qui rendait le bouton « Lancer la
 * cover » de la fiche publication mort pour toute recette sans coverPresetId
 * explicite (cas de toutes les recettes créées depuis l'UI actuelle, qui
 * n'écrit jamais `coverConfig`).
 */

import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";

export const COVER_MODE_VALUES = [
  "none",
  "manualSelect",
  "autoPack",
  "monteurUpload",
] as const;

export type CoverMode = (typeof COVER_MODE_VALUES)[number];

export function isCoverMode(value: unknown): value is CoverMode {
  return typeof value === "string" && (COVER_MODE_VALUES as readonly string[]).includes(value);
}

/** Forme normalisée de `Pattern.coverConfig` (champ JSON opaque). */
export interface PatternCoverConfig {
  /**
   * Règle canonique : absence de config (`{}` ou `null`) N'EST PAS bloquante,
   * seul `enabled: false` explicite désactive la cover auto (legacy). Voir
   * triggerAutoCoverPackForRender.
   */
  enabled: boolean;
  coverPresetId: string | null;
  coverPresetName: string | null;
}

/**
 * Parse `Pattern.coverConfig` (JSON opaque, potentiellement null/incomplet)
 * en forme normalisée. Tolère null, undefined, arrays, primitifs.
 */
export function parsePatternCoverConfig(coverConfig: unknown): PatternCoverConfig {
  if (!coverConfig || typeof coverConfig !== "object" || Array.isArray(coverConfig)) {
    return { enabled: true, coverPresetId: null, coverPresetName: null };
  }
  const raw = coverConfig as { enabled?: unknown; coverPresetId?: unknown; coverPresetName?: unknown };
  return {
    enabled: raw.enabled !== false,
    coverPresetId: typeof raw.coverPresetId === "string" && raw.coverPresetId.length > 0 ? raw.coverPresetId : null,
    coverPresetName:
      typeof raw.coverPresetName === "string" && raw.coverPresetName.length > 0 ? raw.coverPresetName : null,
  };
}

export interface ResolvedCoverPreset {
  id: string;
  name: string;
  config: unknown;
  templateId: string;
}

/**
 * Résout l'UNIQUE TemplateCoverPreset effectif pour un couple (coverConfig,
 * templateId) — cascade id → nom → défaut du template (sortOrder min).
 *
 * `coverConfig` null/incomplet n'est pas bloquant : un preset par défaut
 * (premier par sortOrder) suffit à activer la cover auto. Retourne null si
 * `templateId` est absent, si `coverConfig.enabled === false`, ou si le
 * template n'a aucun preset.
 */
export async function resolveCoverPreset(
  { coverConfig, templateId }: { coverConfig: unknown; templateId: string | null | undefined },
  prisma: PrismaClient = defaultPrisma,
): Promise<ResolvedCoverPreset | null> {
  if (!templateId) return null;
  const parsed = parsePatternCoverConfig(coverConfig);
  if (!parsed.enabled) return null;

  const select = { id: true, name: true, config: true, templateId: true } as const;

  if (parsed.coverPresetId) {
    const byId = await prisma.templateCoverPreset.findUnique({ where: { id: parsed.coverPresetId }, select });
    if (byId) return byId;
  }
  if (parsed.coverPresetName) {
    const byName = await prisma.templateCoverPreset.findUnique({
      where: { templateId_name: { templateId, name: parsed.coverPresetName } },
      select,
    });
    if (byName) return byName;
  }
  return prisma.templateCoverPreset.findFirst({
    where: { templateId },
    orderBy: { sortOrder: "asc" },
    select,
  });
}
