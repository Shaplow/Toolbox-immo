/**
 * POST /api/publications/[id]/recompute-caption
 *
 * Ré-exécute la résolution de la légende « Pré-remplie (modèle) » depuis les
 * champs FRAIS des fiches rattachées (fiche tournage < fiche data), et écrase
 * `slot.description` avec le résultat.
 *
 * Pourquoi cette route existe : `resolvePrefilledCaption` n'est aujourd'hui
 * rejoué qu'au `createSlot` et au (re)rattachement d'une fiche (`patchSlot`
 * avec `propertyId` fourni) — une copie ONE-SHOT, pas une synchronisation
 * live. Éditer les champs de la fiche ENSUITE ne repropage rien vers la
 * légende déjà copiée. Cette route comble l'écart : resynchronisation
 * manuelle, explicite, sur demande de l'utilisateur.
 *
 * Auth : rôle habilité à éditer `description` via PATCH (mêmes rôles que
 * `ALLOWED_PATCH_FIELDS_BY_ROLE[role].includes("description")`, cf.
 * `lib/permissions/slotScope.ts`) + accès au slot (`resolveSlotContext`).
 *
 * Ne s'applique qu'aux modes `needsDescription` gérés par
 * `resolvePrefilledCaption` ("preFilled"/"fixed") — 400 sinon. Règle stricte
 * héritée de `resolvePrefilledCaption` : ne JAMAIS écraser avec une valeur
 * vide (résultat null/blanc → 200 `updated: false`, description inchangée).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSlotContext } from "@/lib/services/slot/resolveSlotContext";
import { ALLOWED_PATCH_FIELDS_BY_ROLE } from "@/lib/permissions/slotScope";
import {
  resolveSlotEffectivePattern,
  slotEffectivePatternSelect,
} from "@/lib/services/slot/effectivePattern";
import { resolvePrefilledCaptionFromEntities } from "@/lib/publications/preFilledDescription";
import { logActivity } from "@/lib/services/slot/activity";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const { id: slotId } = await params;
  const r = await resolveSlotContext(slotId);
  if (r.status === 401) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (r.status === 404) return NextResponse.json({ error: "Slot introuvable" }, { status: 404 });
  const { userContext, role } = r.ctx;

  if (!ALLOWED_PATCH_FIELDS_BY_ROLE[role].includes("description")) {
    return NextResponse.json(
      { error: "Permission insuffisante pour modifier la légende de cette publication" },
      { status: 403 },
    );
  }

  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: {
      id: true,
      needsDescriptionOverride: true,
      entity: { select: { fields: true } },
      shootEntity: { select: { fields: true } },
      ...slotEffectivePatternSelect,
    },
  });
  if (!slot) {
    return NextResponse.json({ error: "Slot introuvable" }, { status: 404 });
  }

  const effectivePattern = resolveSlotEffectivePattern(slot);
  // Override per-slot prime sur le pattern — même précédence que patchSlot.
  const resolvedNeedsDescription =
    slot.needsDescriptionOverride ?? effectivePattern?.needsDescription ?? "none";

  if (resolvedNeedsDescription !== "preFilled" && resolvedNeedsDescription !== "fixed") {
    return NextResponse.json(
      {
        error:
          "Cette recette n'utilise pas de légende pré-remplie depuis une fiche — rien à recalculer.",
      },
      { status: 400 },
    );
  }

  const recomputed = resolvePrefilledCaptionFromEntities(
    {
      needsDescription: resolvedNeedsDescription,
      descriptionFixedText: effectivePattern?.descriptionFixedText ?? null,
      descriptionSourceFieldKey: effectivePattern?.descriptionSourceFieldKey ?? null,
    },
    slot.shootEntity?.fields ?? null,
    slot.entity?.fields ?? null,
  );

  if (recomputed === null) {
    return NextResponse.json({
      ok: true,
      updated: false,
      description: null,
      message: "Aucune valeur exploitable dans la ou les fiches rattachées — légende inchangée.",
    });
  }

  const updated = await prisma.publicationSlot.update({
    where: { id: slotId },
    data: { description: recomputed },
    select: { id: true, description: true },
  });

  await logActivity(prisma, {
    slotId,
    actorId: userContext.actualUser.id,
    type: "DESCRIPTION_PREFILLED",
    payload: { trigger: "manual_recompute" },
  });

  return NextResponse.json({ ok: true, updated: true, description: updated.description });
}
