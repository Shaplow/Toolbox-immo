/**
 * POST /api/publications/[id]/recompute-caption
 *
 * Ré-exécute la résolution de la légende « Pré-remplie (modèle) » depuis les
 * champs FRAIS des fiches rattachées (fiche tournage < fiche data < DataEntry
 * tirée depuis `descriptionDataLibraryId`, cf. `captionDataLibrary.ts`), et
 * écrase `slot.description` avec le résultat.
 *
 * Pourquoi cette route existe : le pré-remplissage n'est aujourd'hui rejoué
 * qu'au `createSlot` et au (re)rattachement d'une fiche (`patchSlot` avec
 * `propertyId` fourni) — une copie ONE-SHOT, pas une synchronisation live.
 * Éditer les champs de la fiche (ou tirer une nouvelle entrée) ENSUITE ne
 * repropage rien vers la légende déjà copiée. Cette route comble l'écart :
 * resynchronisation manuelle, explicite, sur demande de l'utilisateur.
 *
 * Body optionnel `{ redraw?: boolean }` (défaut false) :
 * - redraw=false : réutilise l'entrée mémorisée si elle existe, sinon en
 *   tire une — couvre les slots auto du calendrier, créés sans pré-remplissage.
 * - redraw=true : tire une NOUVELLE entrée et remplace `captionDataEntryId`.
 *
 * Auth : rôle habilité à éditer `description` via PATCH (mêmes rôles que
 * `ALLOWED_PATCH_FIELDS_BY_ROLE[role].includes("description")`, cf.
 * `lib/permissions/slotScope.ts`) + accès au slot (`resolveSlotContext`).
 *
 * Ne s'applique qu'aux modes `needsDescription` gérés par
 * `resolvePrefilledCaption` ("preFilled"/"fixed") — 400 sinon. Règle stricte
 * héritée de `resolvePrefilledCaption` : ne JAMAIS écraser avec une valeur
 * vide (résultat null/blanc → 200 `updated: false`, description inchangée,
 * aucun claim).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSlotContext } from "@/lib/services/slot/resolveSlotContext";
import { ALLOWED_PATCH_FIELDS_BY_ROLE } from "@/lib/permissions/slotScope";
import {
  resolveSlotEffectivePattern,
  slotEffectivePatternSelect,
} from "@/lib/services/slot/effectivePattern";
import { resolveCaptionWithDataLibrary } from "@/lib/publications/captionDataLibrary";
import { claimDataEntryForCaption } from "@/lib/contentLibraryResolver";
import { logActivity } from "@/lib/services/slot/activity";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
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

  const body = await req.json().catch(() => ({}));
  const redraw = (body as { redraw?: unknown })?.redraw === true;

  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: {
      id: true,
      accountId: true,
      needsDescriptionOverride: true,
      entity: { select: { fields: true } },
      shootEntity: { select: { fields: true } },
      captionDataEntry: { select: { id: true, fields: true, setTag: true, libraryId: true } },
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

  const { caption, usedEntry, drewNewEntry } = await resolveCaptionWithDataLibrary({
    config: {
      needsDescription: resolvedNeedsDescription,
      descriptionFixedText: effectivePattern?.descriptionFixedText ?? null,
      descriptionSourceFieldKey: effectivePattern?.descriptionSourceFieldKey ?? null,
      descriptionDataLibraryId: effectivePattern?.descriptionDataLibraryId ?? null,
      descriptionDataSetTag: effectivePattern?.descriptionDataSetTag ?? null,
    },
    accountId: slot.accountId,
    storedEntry: slot.captionDataEntry,
    redraw,
    shootEntityFieldsJson: slot.shootEntity?.fields ?? null,
    entityFieldsJson: slot.entity?.fields ?? null,
  });

  if (caption === null) {
    return NextResponse.json({
      ok: true,
      updated: false,
      description: null,
      entry: null,
      message:
        "Aucune fiche de données disponible (bibliothèque vide, épuisée ou rotation désactivée) — légende inchangée.",
    });
  }

  const updated = await prisma.publicationSlot.update({
    where: { id: slotId },
    data: {
      description: caption,
      ...(drewNewEntry && usedEntry ? { captionDataEntryId: usedEntry.entryId } : {}),
    },
    select: { id: true, description: true },
  });

  if (drewNewEntry && usedEntry) {
    await claimDataEntryForCaption(usedEntry.entryId, slot.accountId);
  }

  await logActivity(prisma, {
    slotId,
    actorId: userContext.actualUser.id,
    type: "DESCRIPTION_PREFILLED",
    payload: {
      trigger: redraw ? "manual_redraw" : "manual_recompute",
      ...(usedEntry
        ? { entryId: usedEntry.entryId, setTag: usedEntry.setTag, libraryId: usedEntry.libraryId }
        : {}),
    },
  });

  return NextResponse.json({
    ok: true,
    updated: true,
    description: updated.description,
    entry: usedEntry
      ? { entryId: usedEntry.entryId, setTag: usedEntry.setTag, libraryId: usedEntry.libraryId, isNew: drewNewEntry }
      : null,
  });
}
