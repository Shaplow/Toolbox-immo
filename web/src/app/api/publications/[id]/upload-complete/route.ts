/**
 * POST /api/publications/[id]/upload-complete
 *
 * Notifie le serveur qu'un upload vers R2 est terminé (single PUT ou multipart).
 *
 * Pour un upload multipart : finalise via CompleteMultipartUpload.
 * Pour un single PUT : vérifie que l'objet existe en R2 (sécurité anti-spoofing).
 *
 * Selon le kind :
 *   rush             → insère PublicationRush + auto-transition RUSHES_UPLOADED_FIRST
 *   version          → calcule versionNumber + insère PublicationVersion + auto-transition
 *   brief-attachment → upsert PublicationBrief + insère PublicationBriefAttachment
 *
 * En cas d'échec Prisma : cleanup R2 obligatoire (abort multipart ou delete).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { canUploadRushes, canUploadVersion, canEditBrief } from "@/lib/permissions/publications";
import { toUserRole } from "@/lib/permissions/role";
import { objectExists, deleteObject, getPublicUrl, isLocalStorage } from "@/lib/storage";
import { completeMultipartUpload, abortMultipartUpload } from "@/lib/r2Multipart";
import { logActivity } from "@/lib/services/slot/activity";
import { applyAutoTransition } from "@/lib/services/slot/transitions";
import { markJobsStaleForSlot } from "@/lib/publications/jobLifecycle";
import { tryAutoTriggerCover } from "@/lib/services/slot/autoCoverTrigger";
import { triggerAutoTranscriptionForVersion } from "@/lib/triggerAutoTranscriptionForVersion";
import { slotEffectivePatternSelect, resolveSlotEffectivePattern } from "@/lib/services/slot/effectivePattern";
import { BRIEF_ATTACHMENT_MIME_TYPES } from "@/lib/briefAttachmentTypes";

type UploadKind = "rush" | "version" | "brief-attachment";

type Params = { params: Promise<{ id: string }> };

// Doit être tenu en synchro avec upload-presign : si l'attaquant déclare
// contentType=video/mp4 au presign puis envoie mimeType=application/x-sh en
// complete, sans cette re-validation le DB stockait le MIME bidon. R2 lie
// le Content-Type aux bytes via la presigned URL, donc l'attaque reste
// limitée à de la pollution métadonnée — mais downstream le render-engine
// décide souvent du traitement selon mimeType.
const ALLOWED_MIME_TYPES_BY_KIND: Record<UploadKind, readonly string[]> = {
  rush: [
    "video/mp4",
    "video/quicktime",
    "video/x-m4v",
    "video/webm",
    "image/jpeg",
    "image/png",
    "image/webp",
  ],
  version: ["video/mp4", "video/quicktime", "video/x-m4v"],
  "brief-attachment": BRIEF_ATTACHMENT_MIME_TYPES,
};

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: Params) {
  // 1. Auth
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id: slotId } = await params;

  // 2. Charger le slot + overrides + pattern (pour résoudre needsAdminValidation
  //    avant de décider si la version uploadée passe par EDIT_REVIEW ou est
  //    auto-promue directement).
  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: {
      id: true,
      status: true,
      assigneeMonteurId: true,
      assigneeCmId: true,
      assigneeVideasteId: true,
      needsAdminValidationOverride: true,
      // Pattern legacy + binding (recette par compte) — voir effectivePattern.ts.
      ...slotEffectivePatternSelect,
    },
  });

  if (!slot || !canUserAccessSlot(slot, role, userId)) {
    return NextResponse.json({ error: "Publication introuvable" }, { status: 404 });
  }

  // 3. Parser le body
  const body = await req.json() as {
    kind?: string;
    r2Key?: string;
    uploadId?: string;
    parts?: { partNumber: number }[];
    fileName?: string;
    mimeType?: string;
    sizeBytes?: number;
    durationSec?: number;
  };

  const { kind, r2Key, uploadId, parts, fileName, mimeType, sizeBytes, durationSec } = body;

  if (!kind || !["rush", "version", "brief-attachment"].includes(kind)) {
    return NextResponse.json(
      { error: "Le champ 'kind' est requis et doit être : rush | version | brief-attachment" },
      { status: 400 }
    );
  }

  if (!r2Key || typeof r2Key !== "string") {
    return NextResponse.json({ error: "Le champ 'r2Key' est requis" }, { status: 400 });
  }

  // Anti cross-slot : la clé R2 doit appartenir à ce slot.
  // Sans ce guard, un MONTEUR assigné au slot A pourrait associer une PublicationVersion
  // pointant vers une clé R2 issue d'un upload-presign sur le slot B.
  if (!r2Key.startsWith(`publications/${slotId}/`)) {
    return NextResponse.json({ error: "Permission refusée" }, { status: 403 });
  }

  if (!fileName || typeof fileName !== "string") {
    return NextResponse.json({ error: "Le champ 'fileName' est requis" }, { status: 400 });
  }

  if (!mimeType || typeof mimeType !== "string") {
    return NextResponse.json({ error: "Le champ 'mimeType' est requis" }, { status: 400 });
  }

  const uploadKind = kind as UploadKind;

  if (!ALLOWED_MIME_TYPES_BY_KIND[uploadKind].includes(mimeType)) {
    return NextResponse.json(
      { error: `mimeType non supporté pour ${uploadKind} : ${mimeType}` },
      { status: 400 },
    );
  }
  const isMultipart = !!(uploadId && parts && Array.isArray(parts) && parts.length > 0);

  // 4. Vérifier la permission par kind
  const user = { id: userId, role };
  if (uploadKind === "rush" && !canUploadRushes(user, slot)) {
    return NextResponse.json({ error: "Permission refusée" }, { status: 403 });
  }
  if (uploadKind === "version" && !canUploadVersion(user, slot)) {
    return NextResponse.json({ error: "Permission refusée" }, { status: 403 });
  }
  if (uploadKind === "brief-attachment" && !canEditBrief(user, slot)) {
    return NextResponse.json({ error: "Permission refusée" }, { status: 403 });
  }

  // 5. Finaliser l'upload R2
  if (isMultipart) {
    try {
      await completeMultipartUpload(r2Key, uploadId!, parts!);
    } catch (err) {
      console.error(`[upload-complete] completeMultipartUpload failed for key=${r2Key}:`, err);
      return NextResponse.json(
        { error: "Échec de la finalisation de l'upload multipart" },
        { status: 500 }
      );
    }
  } else {
    // Single PUT : vérifier que l'objet est bien présent (R2 ou disque local).
    const exists = await objectExists(r2Key);
    if (!exists) {
      return NextResponse.json(
        { error: "Le fichier n'est pas encore disponible. Vérifiez que l'upload est terminé." },
        { status: 400 }
      );
    }
  }

  // 6. Logique métier transactionnelle
  const fileUrl = getPublicUrl(r2Key);

  try {
    if (uploadKind === "rush") {
      return await handleRushComplete({
        prisma, slotId, slot, userId, actorId: userContext.actualUser.id, r2Key, fileUrl, fileName, mimeType, sizeBytes, durationSec,
        isMultipart, uploadId,
      });
    }

    if (uploadKind === "version") {
      // Phase 2.3 — needsAdminValidation effectif (override > pattern > false).
      const needsAdminValidation =
        slot.needsAdminValidationOverride ??
        resolveSlotEffectivePattern(slot)?.needsAdminValidation ??
        false;
      return await handleVersionComplete({
        prisma, slotId, slot, userId, actorId: userContext.actualUser.id, r2Key, fileUrl, fileName, mimeType, sizeBytes, durationSec,
        isMultipart, uploadId, needsAdminValidation,
      });
    }

    // brief-attachment
    return await handleBriefAttachmentComplete({
      prisma, slotId, slot, userId, actorId: userContext.actualUser.id, r2Key, fileName, mimeType, sizeBytes,
      isMultipart, uploadId,
    });

  } catch (err) {
    // Cleanup storage si insert Prisma échoue (R2 ou disque local).
    console.error(`[upload-complete] Prisma insert failed, cleaning up storage key=${r2Key}:`, err);
    try {
      if (isMultipart && uploadId && !isLocalStorage()) {
        await abortMultipartUpload(r2Key, uploadId);
      } else {
        await deleteObject(r2Key);
      }
    } catch (cleanupErr) {
      console.error(`[upload-complete] cleanup failed for key=${r2Key}:`, cleanupErr);
    }
    return NextResponse.json(
      { error: "Erreur lors de l'enregistrement. L'upload a été annulé." },
      { status: 500 }
    );
  }
}

// ─── Rush ──────────────────────────────────────────────────────────────────────

async function handleRushComplete(args: {
  prisma: typeof import("@/lib/prisma").prisma;
  slotId: string;
  slot: { status: string };
  userId: string;
  /** actualUser.id — vrai déclencheur de l'action, distinct du data
   *  owner userId (effectiveUser.id) pour l'audit. */
  actorId: string;
  r2Key: string;
  fileUrl: string;
  fileName: string;
  mimeType: string;
  sizeBytes?: number;
  durationSec?: number;
  isMultipart: boolean;
  uploadId?: string;
}): Promise<NextResponse> {
  const { slotId, slot, userId, actorId, r2Key, fileName, mimeType, sizeBytes, durationSec } = args;

  // Insert + count + activity + auto-transition dans une seule transaction pour éviter
  // un double STATUS_CHANGED parasite en cas d'uploads concurrents.
  const rush = await args.prisma.$transaction(async (tx) => {
    const created = await tx.publicationRush.create({
      data: {
        slotId,
        r2Key,
        fileName,
        mimeType,
        sizeBytes: sizeBytes ?? null,
        durationSec: durationSec ?? null,
        uploadedByUserId: userId,
      },
      select: { id: true },
    });

    const rushCount = await tx.publicationRush.count({
      where: { slotId, deletedAt: null },
    });

    await logActivity(tx as typeof args.prisma, {
      slotId,
      actorId,
      type: "RUSHES_UPLOADED",
      payload: { rushId: created.id, fileName, mimeType },
    });

    if (rushCount === 1) {
      await applyAutoTransition(tx as typeof args.prisma, slotId, slot.status, "RUSHES_UPLOADED_FIRST", actorId);
    }

    return created;
  });

  return NextResponse.json({ ok: true, id: rush.id });
}

// ─── Version ──────────────────────────────────────────────────────────────────

async function handleVersionComplete(args: {
  prisma: typeof import("@/lib/prisma").prisma;
  slotId: string;
  slot: { status: string };
  userId: string;
  /** actualUser.id — vrai déclencheur (audit). */
  actorId: string;
  r2Key: string;
  fileUrl: string;
  fileName: string;
  mimeType: string;
  sizeBytes?: number;
  durationSec?: number;
  isMultipart: boolean;
  uploadId?: string;
  /** Phase 2.3 — true : EDIT_REVIEW intercalé (admin promote manuelle).
   *  false : version uploadée auto-promue + transition EDIT_APPROVED. */
  needsAdminValidation: boolean;
}): Promise<NextResponse> {
  const { slotId, slot, userId, actorId, r2Key, fileUrl, fileName, mimeType, sizeBytes, durationSec, needsAdminValidation } = args;

  // Tout dans une seule transaction : versionNumber calculé atomiquement,
  // logActivity et applyAutoTransition cohérents (pas de drift slot.status / DB).
  const result = await args.prisma.$transaction(async (tx) => {
    const agg = await tx.publicationVersion.aggregate({
      where: { slotId },
      _max: { versionNumber: true },
    });
    const versionNumber = (agg._max.versionNumber ?? 0) + 1;

    const version = await tx.publicationVersion.create({
      data: {
        slotId,
        versionNumber,
        r2Key,
        fileUrl,
        fileName,
        mimeType,
        fileSizeBytes: sizeBytes ?? null,
        durationSec: durationSec ?? null,
        uploadedByUserId: userId,
      },
      select: { id: true, versionNumber: true },
    });

    await logActivity(tx as typeof args.prisma, {
      slotId,
      actorId,
      type: "VERSION_UPLOADED",
      payload: { versionId: version.id, versionNumber: version.versionNumber, fileName },
    });

    // Re-lire le statut dans la transaction : sans ça, on pousse au trigger
    // la valeur capturée AVANT la requête (slot.status pris en dehors de
    // la tx). Si un autre acteur — ex. un ADMIN qui avance le slot — a
    // modifié le statut entre-temps, la matrice computeAutoTransition
    // recevait une valeur stale et l'auto-transition ne se déclenchait
    // pas (cas VERSION_UPLOADED_AGAIN qui attend EDIT_APPROVED).
    const fresh = await tx.publicationSlot.findUnique({
      where: { id: slotId },
      select: { status: true },
    });
    const freshStatus = fresh?.status ?? slot.status;

    // Phase 2.3 — flux selon needsAdminValidation effectif.
    //
    // - needsAdminValidation === true  : flux historique. Upload → EDIT_REVIEW
    //   (admin promote manuelle). Idem pour les révisions.
    // - needsAdminValidation === false : la version uploadée devient
    //   currentVersion automatiquement.
    //     - Pour la 1ère version : on déclenche la transition de statut
    //       VERSION_PROMOTED → EDIT_APPROVED (workflow standard avance).
    //     - Pour les révisions (v2+) : on met juste à jour currentVersionId
    //       sans toucher au statut. Le slot peut être à n'importe quel
    //       moment du cycle (CLIENT_REVISION, AWAITING_CLIENT, SCHEDULED…),
    //       l'humain décide la suite — l'auto-transition serait dangereuse
    //       (risque de remettre le slot en arrière par rapport aux décisions
    //       client/CM déjà prises en aval).
    if (!needsAdminValidation) {
      await tx.publicationSlot.update({
        where: { id: slotId },
        data: { currentVersionId: version.id },
      });
      await logActivity(tx as typeof args.prisma, {
        slotId,
        actorId,
        type: "VERSION_PROMOTED",
        payload: {
          versionId: version.id,
          versionNumber: version.versionNumber,
          autoPromoted: true,
          reason: "needsAdminValidation_disabled",
        },
      });
      // W5.5 : symétrie audit avec promote/route.ts — sans ça, l'activity
      // timeline montre 2 events distincts pour la même action sémantique
      // (manual promote = VERSION_PROMOTED + CURRENT_VERSION_CHANGED ;
      // auto-promote = VERSION_PROMOTED seul). Support/audit ne peut pas
      // reconstituer un historique homogène.
      await logActivity(tx as typeof args.prisma, {
        slotId,
        actorId,
        type: "CURRENT_VERSION_CHANGED",
        payload: {
          versionId: version.id,
          versionNumber: version.versionNumber,
          previousVersionId: null,
          autoPromoted: true,
        },
      });
      if (version.versionNumber === 1) {
        await applyAutoTransition(tx as typeof args.prisma, slotId, freshStatus, "VERSION_PROMOTED", actorId);
      }
      // versionNumber > 1 : pas de transition. Le slot reste où il est.
      // Symétrie avec le promote manuel (promote/route.ts) : invalider les jobs
      // (transcription/captions/description/cover) de l'ancienne version pour
      // qu'ils ne s'affichent plus comme "courants" sur la fiche. Idempotent
      // (ne touche que staleSince=null) → no-op pour la V1, invalide V(n-1).
      await markJobsStaleForSlot(tx, slotId, "version_promoted");
    } else {
      const trigger = version.versionNumber === 1 ? "VERSION_UPLOADED_FIRST" : "VERSION_UPLOADED_AGAIN";
      await applyAutoTransition(tx as typeof args.prisma, slotId, freshStatus, trigger, actorId);
    }

    return version;
  });

  // Phase 2.3 + 2.4 — déclenchement de la chaîne auto post auto-promote.
  // Sans ce câblage, manual_rushes + needsAdminValidation=false ne lance
  // jamais cover/transcription/captions/description et le slot reste muet.
  if (!needsAdminValidation && result.versionNumber === 1) {
    // Cover
    const coverResult = await tryAutoTriggerCover({
      slotId,
      actorId,
      trigger: "AUTO_POST_PROMOTE",
    });
    if (coverResult.status === "error") {
      console.error(`[upload-complete] auto-cover post auto-promote failed slot=${slotId}:`, coverResult.reason);
    } else if (coverResult.status === "skipped") {
      console.info(`[upload-complete] auto-cover skipped slot=${slotId}: ${coverResult.reason}`);
    }

    // Transcription (qui consommera captions + description en cascade via le
    // webhook RunPod /api/webhooks/runpod/transcription).
    void triggerAutoTranscriptionForVersion(result.id).catch((err) =>
      console.error(`[upload-complete] auto-transcription post auto-promote threw slot=${slotId}:`, err),
    );
  }

  return NextResponse.json({ ok: true, id: result.id, versionNumber: result.versionNumber });
}

// ─── Brief attachment ─────────────────────────────────────────────────────────

async function handleBriefAttachmentComplete(args: {
  prisma: typeof import("@/lib/prisma").prisma;
  slotId: string;
  slot: { status: string };
  userId: string;
  /** actualUser.id — vrai déclencheur (audit). */
  actorId: string;
  r2Key: string;
  fileName: string;
  mimeType: string;
  sizeBytes?: number;
  isMultipart: boolean;
  uploadId?: string;
}): Promise<NextResponse> {
  const { slotId, userId, actorId, r2Key, fileName, mimeType, sizeBytes } = args;

  // Fix bug audit 2026-05-30 (M5) : logActivity déplacé DANS la transaction.
  // Anciennement après le commit → crash entre commit et log = attachment créé
  // sans entrée dans le fil d'activité. Cohérent avec les autres handlers
  // (rush / version) qui logguent intra-tx.
  const attachment = await args.prisma.$transaction(async (tx) => {
    const brief = await tx.publicationBrief.upsert({
      where: { slotId },
      update: { updatedByUserId: userId },
      create: { slotId, updatedByUserId: userId },
      select: { id: true },
    });

    const att = await tx.publicationBriefAttachment.create({
      data: {
        briefId: brief.id,
        r2Key,
        fileName,
        mimeType,
        sizeBytes: sizeBytes ?? null,
      },
      select: { id: true },
    });

    await logActivity(tx, {
      slotId,
      actorId,
      type: "BRIEF_UPDATED",
      payload: { attachmentId: att.id, fileName, mimeType },
    });

    return att;
  });

  return NextResponse.json({ ok: true, id: attachment.id });
}
