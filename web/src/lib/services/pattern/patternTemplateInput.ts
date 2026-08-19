/**
 * Entrée partagée pour le CRUD PatternTemplate (recette) — consommée par
 * POST/PATCH /api/admin/patterns[/[id]] et par le sous-payload `template` de
 * POST/PATCH /api/admin/accounts/[id]/recipes[/[bindingId]].
 *
 * Avant cette extraction, les gardes de validation enum et le mapping Prisma
 * (~20 champs) étaient dupliqués sur les 4 routes, avec deux divergences
 * réelles :
 *  - `autoSaveToLibraryId` (existence en DB + `type === "video"`) était
 *    validé sur /patterns mais totalement absent des deux routes /recipes,
 *    alors que RecipeForm.tsx envoie bien ce champ (écriture non protégée
 *    jusqu'à autoSaveToLibrary.ts en aval).
 *  - un `label` vide était accepté par PATCH /patterns/[id] mais refusé par
 *    PATCH /recipes/[bindingId] ("template.label vide interdit").
 * Les deux sont corrigés ici : validés dans tous les appelants.
 *
 * `fieldPrefix` reproduit le préfixage "template." des messages d'erreur des
 * routes /recipes (le payload y est imbriqué sous `template`) sans le
 * dupliquer côté /patterns où il n'y a pas de préfixe.
 *
 * Les VALEURS d'enum vivent dans lib/publications/patternEnums.ts ; ce
 * module ne fait que garder les gardes `!VALID_X.includes(x)` en un seul
 * endroit.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import {
  VALID_SOURCES,
  VALID_CAPTIONS_MODES,
  VALID_DESCRIPTION_MODES,
  VALID_COVER_MODES,
} from "@/lib/publications/patternEnums";
import {
  normalizeSourceFieldKey,
  normalizeFixedText,
} from "@/lib/publications/preFilledDescription";

export interface PatternTemplateInputPayload {
  label?: string;
  source?: string;
  templateId?: string | null;
  captionPresetId?: string | null;
  descriptionPromptId?: string | null;
  descriptionSourceFieldKey?: string | null;
  descriptionFixedText?: string | null;
  descriptionDataLibraryId?: string | null;
  coverMode?: string;
  needsDescription?: string;
  needsCaptionsMode?: string;
  needsAdminValidation?: boolean;
  needsClientValidation?: boolean;
  allowsClientRevision?: boolean;
  needsBrief?: boolean;
  /** @deprecated Legacy — remplacé par requiresEntityTypeId. Écriture encore active (backfill pas fait). */
  requiresProperty?: boolean;
  requiresEntityTypeId?: string | null;
  notes?: string | null;
  autoSaveToLibraryId?: string | null;
  /** PATCH /patterns/[id] uniquement — ignoré par les routes /recipes qui ne l'envoient jamais. */
  isArchived?: boolean;
}

export interface ValidatePatternTemplateInputOptions {
  /** true en création (POST) : label + source obligatoires. false en édition partielle (PATCH) : chaque champ n'est validé que s'il est fourni. */
  requireAll: boolean;
  /** Préfixe des messages d'erreur — "template." pour le sous-payload des routes /recipes, vide pour /patterns. */
  fieldPrefix?: string;
}

/**
 * Valide un payload de création/édition de PatternTemplate : gardes enum,
 * existence de `requiresEntityTypeId`, existence + type vidéo de
 * `autoSaveToLibraryId`, non-vacuité de `label`. Retourne un message
 * d'erreur exploitable tel quel dans `NextResponse.json({ error }, {status:400})`,
 * ou `null` si le payload est valide.
 */
export async function validatePatternTemplateInput(
  body: PatternTemplateInputPayload,
  { requireAll, fieldPrefix = "" }: ValidatePatternTemplateInputOptions,
  prisma: PrismaClient = defaultPrisma,
): Promise<string | null> {
  if (requireAll) {
    if (!body.label?.trim()) return `${fieldPrefix}label requis`;
    if (!body.source) return `${fieldPrefix}source requise`;
  } else if (body.label !== undefined && !body.label.trim()) {
    return `${fieldPrefix}label vide interdit`;
  }
  if (body.source !== undefined && !VALID_SOURCES.includes(body.source)) {
    return `${fieldPrefix}source invalide (attendu : ${VALID_SOURCES.join(", ")})`;
  }
  if (body.needsCaptionsMode !== undefined && !VALID_CAPTIONS_MODES.includes(body.needsCaptionsMode)) {
    return `${fieldPrefix}needsCaptionsMode invalide`;
  }
  if (body.needsDescription !== undefined && !VALID_DESCRIPTION_MODES.includes(body.needsDescription)) {
    return `${fieldPrefix}needsDescription invalide`;
  }
  if (body.coverMode !== undefined && !VALID_COVER_MODES.includes(body.coverMode)) {
    return `${fieldPrefix}coverMode invalide`;
  }

  if (body.requiresEntityTypeId) {
    const type = await prisma.entityType.findUnique({
      where: { id: body.requiresEntityTypeId },
      select: { id: true },
    });
    if (!type) return `${fieldPrefix}requiresEntityTypeId : type de fiche introuvable`;
  }

  if (body.autoSaveToLibraryId) {
    const lib = await prisma.mediaLibrary.findUnique({
      where: { id: body.autoSaveToLibraryId },
      select: { id: true, type: true },
    });
    if (!lib) return `${fieldPrefix}autoSaveToLibraryId : bibliothèque introuvable`;
    if (lib.type !== "video") {
      return `${fieldPrefix}autoSaveToLibraryId : la bibliothèque doit être de type vidéo`;
    }
  }

  if (body.descriptionDataLibraryId) {
    const dataLib = await prisma.dataLibrary.findUnique({
      where: { id: body.descriptionDataLibraryId },
      select: { id: true },
    });
    if (!dataLib) return `${fieldPrefix}descriptionDataLibraryId : bibliothèque de données introuvable`;
  }

  return null;
}

/** À appeler uniquement après un `validatePatternTemplateInput` réussi (label/source non-null garantis). */
export function toPatternTemplateCreateData(
  payload: PatternTemplateInputPayload,
  updatedByUserId: string,
): Prisma.PatternTemplateUncheckedCreateInput {
  return {
    label: payload.label!.trim(),
    source: payload.source!,
    templateId: payload.templateId ?? null,
    captionPresetId: payload.captionPresetId ?? null,
    descriptionPromptId: payload.descriptionPromptId ?? null,
    descriptionSourceFieldKey: normalizeSourceFieldKey(payload.descriptionSourceFieldKey),
    descriptionFixedText: normalizeFixedText(payload.descriptionFixedText),
    descriptionDataLibraryId: payload.descriptionDataLibraryId ?? null,
    coverMode: payload.coverMode ?? "none",
    needsDescription: payload.needsDescription ?? "none",
    needsCaptionsMode: payload.needsCaptionsMode ?? "none",
    needsAdminValidation: payload.needsAdminValidation ?? false,
    needsClientValidation: payload.needsClientValidation ?? false,
    allowsClientRevision: payload.allowsClientRevision ?? false,
    needsBrief: payload.needsBrief ?? false,
    requiresProperty: payload.requiresProperty ?? false,
    requiresEntityTypeId: payload.requiresEntityTypeId ?? null,
    autoSaveToLibraryId: payload.autoSaveToLibraryId ?? null,
    notes: payload.notes ?? null,
    updatedByUserId,
  };
}

export function toPatternTemplateUpdateData(
  payload: PatternTemplateInputPayload,
  updatedByUserId: string,
): Prisma.PatternTemplateUncheckedUpdateInput {
  return {
    ...(payload.label !== undefined ? { label: payload.label.trim() } : {}),
    ...(payload.source !== undefined ? { source: payload.source } : {}),
    ...(payload.templateId !== undefined ? { templateId: payload.templateId } : {}),
    ...(payload.captionPresetId !== undefined ? { captionPresetId: payload.captionPresetId } : {}),
    ...(payload.descriptionPromptId !== undefined ? { descriptionPromptId: payload.descriptionPromptId } : {}),
    ...(payload.descriptionSourceFieldKey !== undefined
      ? { descriptionSourceFieldKey: normalizeSourceFieldKey(payload.descriptionSourceFieldKey) }
      : {}),
    ...(payload.descriptionFixedText !== undefined
      ? { descriptionFixedText: normalizeFixedText(payload.descriptionFixedText) }
      : {}),
    ...(payload.descriptionDataLibraryId !== undefined
      ? { descriptionDataLibraryId: payload.descriptionDataLibraryId }
      : {}),
    ...(payload.coverMode !== undefined ? { coverMode: payload.coverMode } : {}),
    ...(payload.needsDescription !== undefined ? { needsDescription: payload.needsDescription } : {}),
    ...(payload.needsCaptionsMode !== undefined ? { needsCaptionsMode: payload.needsCaptionsMode } : {}),
    ...(payload.needsAdminValidation !== undefined ? { needsAdminValidation: payload.needsAdminValidation } : {}),
    ...(payload.needsClientValidation !== undefined ? { needsClientValidation: payload.needsClientValidation } : {}),
    ...(payload.allowsClientRevision !== undefined ? { allowsClientRevision: payload.allowsClientRevision } : {}),
    ...(payload.needsBrief !== undefined ? { needsBrief: payload.needsBrief } : {}),
    ...(payload.requiresProperty !== undefined ? { requiresProperty: payload.requiresProperty } : {}),
    ...(payload.requiresEntityTypeId !== undefined ? { requiresEntityTypeId: payload.requiresEntityTypeId } : {}),
    ...(payload.autoSaveToLibraryId !== undefined ? { autoSaveToLibraryId: payload.autoSaveToLibraryId } : {}),
    ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
    ...(payload.isArchived !== undefined ? { isArchived: payload.isArchived } : {}),
    updatedByUserId,
  };
}
