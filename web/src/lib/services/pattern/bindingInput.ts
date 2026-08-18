/**
 * Entrée partagée pour le CRUD PatternBinding (application d'une recette à
 * un compte) — consommée par le sous-payload `binding` de POST/PATCH
 * /api/admin/accounts/[id]/recipes[/[bindingId]].
 *
 * Avant cette extraction, la validation (publishTime, dayOfWeek,
 * coverModeOverride) et le mapping Prisma étaient dupliqués entre le POST
 * (création — publishTime obligatoire) et le PATCH (édition partielle — tout
 * optionnel) de ces deux routes.
 *
 * deployTemplateToAccounts (déploiement multi-comptes) a ses propres gardes
 * (accountIds, assertAssigneeRole) et n'est pas concerné par ce module.
 */
import type { Prisma } from "@prisma/client";
import { PUBLISH_TIME_RE, VALID_COVER_MODES } from "@/lib/publications/patternEnums";

export interface PatternBindingInputPayload {
  customLabel?: string | null;
  dayOfWeek?: number[];
  publishTime?: string;
  isActive?: boolean;
  defaultAssigneeMonteurId?: string | null;
  defaultAssigneeCmId?: string | null;
  defaultAssigneeVideasteId?: string | null;
  captionPresetIdOverride?: string | null;
  descriptionPromptIdOverride?: string | null;
  coverModeOverride?: string | null;
  notes?: string | null;
}

export interface ValidateBindingInputOptions {
  /** true en création (POST) : publishTime obligatoire. */
  requireAll: boolean;
  /** Préfixe des messages d'erreur — "binding." pour le sous-payload des routes /recipes. */
  fieldPrefix?: string;
}

/**
 * Valide un payload de création/édition de PatternBinding. Retourne un
 * message d'erreur exploitable tel quel dans
 * `NextResponse.json({ error }, { status: 400 })`, ou `null` si valide.
 */
export function validateBindingInput(
  body: PatternBindingInputPayload,
  { requireAll, fieldPrefix = "" }: ValidateBindingInputOptions,
): string | null {
  if (requireAll && !body.publishTime) return `${fieldPrefix}publishTime requis`;
  if (body.publishTime !== undefined && !PUBLISH_TIME_RE.test(body.publishTime)) {
    return `${fieldPrefix}publishTime doit être HH:MM`;
  }
  if (body.dayOfWeek !== undefined) {
    if (!Array.isArray(body.dayOfWeek)) return `${fieldPrefix}dayOfWeek doit être un tableau`;
    for (const d of body.dayOfWeek) {
      if (!Number.isInteger(d) || d < 1 || d > 7) {
        return `${fieldPrefix}dayOfWeek doit contenir des entiers 1-7`;
      }
    }
  }
  if (
    body.coverModeOverride !== undefined &&
    body.coverModeOverride !== null &&
    !VALID_COVER_MODES.includes(body.coverModeOverride)
  ) {
    return `${fieldPrefix}coverModeOverride invalide`;
  }
  return null;
}

/** À appeler uniquement après un `validateBindingInput` réussi (publishTime non-null garanti). */
export function toPatternBindingCreateData(
  payload: PatternBindingInputPayload,
  ctx: { accountId: string; patternTemplateId: string },
): Prisma.PatternBindingUncheckedCreateInput {
  return {
    accountId: ctx.accountId,
    patternTemplateId: ctx.patternTemplateId,
    customLabel: payload.customLabel ?? null,
    dayOfWeek: payload.dayOfWeek ?? [],
    publishTime: payload.publishTime!,
    isActive: payload.isActive ?? true,
    defaultAssigneeMonteurId: payload.defaultAssigneeMonteurId ?? null,
    defaultAssigneeCmId: payload.defaultAssigneeCmId ?? null,
    defaultAssigneeVideasteId: payload.defaultAssigneeVideasteId ?? null,
    captionPresetIdOverride: payload.captionPresetIdOverride ?? null,
    descriptionPromptIdOverride: payload.descriptionPromptIdOverride ?? null,
    coverModeOverride: payload.coverModeOverride ?? null,
    notes: payload.notes ?? null,
  };
}

export function toPatternBindingUpdateData(
  payload: PatternBindingInputPayload,
): Prisma.PatternBindingUncheckedUpdateInput {
  return {
    ...(payload.customLabel !== undefined ? { customLabel: payload.customLabel } : {}),
    ...(payload.dayOfWeek !== undefined ? { dayOfWeek: payload.dayOfWeek } : {}),
    ...(payload.publishTime !== undefined ? { publishTime: payload.publishTime } : {}),
    ...(payload.isActive !== undefined ? { isActive: payload.isActive } : {}),
    ...(payload.defaultAssigneeMonteurId !== undefined
      ? { defaultAssigneeMonteurId: payload.defaultAssigneeMonteurId }
      : {}),
    ...(payload.defaultAssigneeCmId !== undefined ? { defaultAssigneeCmId: payload.defaultAssigneeCmId } : {}),
    ...(payload.defaultAssigneeVideasteId !== undefined
      ? { defaultAssigneeVideasteId: payload.defaultAssigneeVideasteId }
      : {}),
    ...(payload.captionPresetIdOverride !== undefined
      ? { captionPresetIdOverride: payload.captionPresetIdOverride }
      : {}),
    ...(payload.descriptionPromptIdOverride !== undefined
      ? { descriptionPromptIdOverride: payload.descriptionPromptIdOverride }
      : {}),
    ...(payload.coverModeOverride !== undefined ? { coverModeOverride: payload.coverModeOverride } : {}),
    ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
  };
}
