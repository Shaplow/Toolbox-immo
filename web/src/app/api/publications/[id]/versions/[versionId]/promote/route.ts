/**
 * POST /api/publications/[id]/versions/[versionId]/promote
 *
 * Promeut une version en version courante du slot.
 * Auth : ADMIN seul (canPromoteVersion).
 *
 * Effets :
 * 1. Update PublicationSlot.currentVersionId = versionId.
 * 2. applyAutoTransition(VERSION_PROMOTED) → passage en EDIT_APPROVED si applicable.
 * 3. Log VERSION_PROMOTED + CURRENT_VERSION_CHANGED.
 *
 * Erreurs :
 * - 403 si pas ADMIN.
 * - 400 si version supprimée ou déjà courante.
 * - 404 si slot ou version introuvables / non accessibles.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { canPromoteVersion } from "@/lib/permissions/publications";
import { toUserRole } from "@/lib/permissions/role";
import { logActivity } from "@/lib/services/slot/activity";
import { applyAutoTransition } from "@/lib/services/slot/transitions";
import { tryAutoTriggerCover } from "@/lib/services/slot/autoCoverTrigger";
import { triggerAutoTranscriptionForVersion } from "@/lib/triggerAutoTranscriptionForVersion";
import { markJobsStaleForSlot } from "@/lib/publications/jobLifecycle";

type Params = { params: Promise<{ id: string; versionId: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  // 1. Auth
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;

  // 2. Permission : ADMIN seul
  if (!canPromoteVersion({ role })) {
    return NextResponse.json({ error: "Seul un ADMIN peut promouvoir une version" }, { status: 403 });
  }

  const { id: slotId, versionId } = await params;

  // 3. Charger le slot
  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: {
      id: true,
      status: true,
      currentVersionId: true,
      assigneeMonteurId: true,
      assigneeCmId: true, assigneeVideasteId: true,
    },
  });

  if (!slot || !canUserAccessSlot(slot, role, userId)) {
    return NextResponse.json({ error: "Publication introuvable" }, { status: 404 });
  }

  // 4. Charger la version
  const version = await prisma.publicationVersion.findFirst({
    where: { id: versionId, slotId },
    select: { id: true, versionNumber: true, deletedAt: true },
  });

  if (!version) {
    return NextResponse.json({ error: "Version introuvable" }, { status: 404 });
  }

  if (version.deletedAt !== null) {
    return NextResponse.json(
      { error: "Impossible de promouvoir une version supprimée" },
      { status: 400 }
    );
  }

  if (slot.currentVersionId === versionId) {
    return NextResponse.json(
      { error: "Cette version est déjà la version courante" },
      { status: 400 }
    );
  }

  // 5. Transaction : update slot + log activités + auto-transition (atomique)
  const previousVersionId = slot.currentVersionId;

  // Fetch previousVersionNumber hors tx pour enrichir le payload activity log
  // (ActivityTimeline lit previousVersionNumber + versionNumber pour afficher
  // "V1 → V2" — sans ces champs, on a un permanent "V? → V?").
  let previousVersionNumber: number | null = null;
  if (previousVersionId) {
    const prev = await prisma.publicationVersion.findUnique({
      where: { id: previousVersionId },
      select: { versionNumber: true },
    });
    previousVersionNumber = prev?.versionNumber ?? null;
  }

  await prisma.$transaction(async (tx) => {
    // Update la version courante
    await tx.publicationSlot.update({
      where: { id: slotId },
      data: { currentVersionId: versionId },
    });

    // Log VERSION_PROMOTED
    await logActivity(tx as typeof prisma, {
      slotId,
      actorId: userContext.actualUser.id,
      type: "VERSION_PROMOTED",
      payload: {
        versionId,
        versionNumber: version.versionNumber,
        previousVersionId: previousVersionId ?? null,
      },
    });

    // Log CURRENT_VERSION_CHANGED
    await logActivity(tx as typeof prisma, {
      slotId,
      actorId: userContext.actualUser.id,
      type: "CURRENT_VERSION_CHANGED",
      payload: {
        from: previousVersionId ?? null,
        to: versionId,
        previousVersionNumber,
        versionNumber: version.versionNumber,
      },
    });

    // Auto-transition dans la même tx — évite un statut figé sur EDIT_REVIEW
    // si le process crash entre le commit de la tx et l'appel hors-tx.
    await applyAutoTransition(tx as typeof prisma, slotId, slot.status, "VERSION_PROMOTED", userContext.actualUser.id);
  });

  // V6.3 — Cascade d'invalidation : marquer comme stale tous les jobs aval
  // liés à l'ancienne version (CaptionJob, DescriptionJob, CoverFramePack,
  // TranscriptionJob). Reset slot.active*Id à null. La fiche affichera
  // désormais ces jobs avec un badge "Obsolète" (vague V6.5).
  // Exécuté hors transaction (best-effort) pour ne pas bloquer la promotion
  // si une stale-mark échoue.
  let staleCounts = {
    captionJobsMarkedCount: 0,
    descriptionJobsMarkedCount: 0,
    coverPacksMarkedCount: 0,
    transcriptionJobsMarkedCount: 0,
  };
  if (previousVersionId) {
    try {
      staleCounts = await markJobsStaleForSlot(prisma, slotId, "version_promoted");
      console.info(
        `[promote] slot=${slotId} jobs marked stale: captions=${staleCounts.captionJobsMarkedCount} desc=${staleCounts.descriptionJobsMarkedCount} cover=${staleCounts.coverPacksMarkedCount} trans=${staleCounts.transcriptionJobsMarkedCount}`,
      );
    } catch (err) {
      console.error(`[promote] markJobsStaleForSlot failed slot=${slotId}:`, err);
    }
  }

  // Auto-trigger cover si pattern.coverMode = "auto" et preset configuré.
  // Best-effort (jamais throw) — log uniquement en cas de skip/erreur.
  // S'exécute après la transaction pour ne pas perturber la promotion.
  const coverResult = await tryAutoTriggerCover({
    slotId,
    actorId: userContext.actualUser.id,
    trigger: "AUTO_POST_PROMOTE",
  });
  if (coverResult.status === "error") {
    console.error(`[promote] auto-cover trigger failed for slot=${slotId}:`, coverResult.reason);
  } else if (coverResult.status === "skipped") {
    console.info(`[promote] auto-cover skipped for slot=${slotId}: ${coverResult.reason}`);
  }

  // Phase 2.4 — chaîne auto transcription/caption/description pour
  // manual_rushes / external_upload. Fire-and-forget : la transcription est
  // longue (~30s à plusieurs minutes selon la durée vidéo), le promote
  // répond immédiatement et la suite est asynchrone via webhook.
  void triggerAutoTranscriptionForVersion(versionId).catch((err) =>
    console.error(`[promote] auto-transcription threw for slot=${slotId}:`, err),
  );

  return NextResponse.json({
    ok: true,
    currentVersionId: versionId,
    autoCover: coverResult,
    // V6.5.2 — counts de jobs marqués stale pour toast UI côté VersionsSection.
    staleCounts,
  });
}
