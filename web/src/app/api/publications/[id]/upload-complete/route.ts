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
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { canUploadRushes, canUploadVersion, canEditBrief } from "@/lib/permissions/publications";
import { toUserRole } from "@/lib/permissions/role";
import { objectExistsInR2, deleteFromR2, getR2PublicUrl } from "@/lib/r2";
import { completeMultipartUpload, abortMultipartUpload } from "@/lib/r2Multipart";
import { logActivity } from "@/lib/services/slot/activity";
import { applyAutoTransition } from "@/lib/services/slot/transitions";

type UploadKind = "rush" | "version" | "brief-attachment";

type Params = { params: Promise<{ id: string }> };

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: Params) {
  // 1. Auth
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id: slotId } = await params;

  // 2. Charger le slot
  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: {
      id: true,
      status: true,
      assigneeMonteurId: true,
      assigneeCmId: true, assigneeVideasteId: true,
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
    parts?: { partNumber: number; etag: string }[];
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
    // Single PUT : vérifier que l'objet est bien présent en R2
    const exists = await objectExistsInR2(r2Key);
    if (!exists) {
      return NextResponse.json(
        { error: "Le fichier n'est pas encore disponible en R2. Vérifiez que l'upload est terminé." },
        { status: 400 }
      );
    }
  }

  // 6. Logique métier transactionnelle
  const fileUrl = getR2PublicUrl(r2Key);

  try {
    if (uploadKind === "rush") {
      return await handleRushComplete({
        prisma, slotId, slot, userId, actorId: userContext.actualUser.id, r2Key, fileUrl, fileName, mimeType, sizeBytes, durationSec,
        isMultipart, uploadId,
      });
    }

    if (uploadKind === "version") {
      return await handleVersionComplete({
        prisma, slotId, slot, userId, actorId: userContext.actualUser.id, r2Key, fileUrl, fileName, mimeType, sizeBytes, durationSec,
        isMultipart, uploadId,
      });
    }

    // brief-attachment
    return await handleBriefAttachmentComplete({
      prisma, slotId, slot, userId, actorId: userContext.actualUser.id, r2Key, fileName, mimeType, sizeBytes,
      isMultipart, uploadId,
    });

  } catch (err) {
    // Cleanup R2 si insert Prisma échoue
    console.error(`[upload-complete] Prisma insert failed, cleaning up R2 key=${r2Key}:`, err);
    try {
      if (isMultipart && uploadId) {
        await abortMultipartUpload(r2Key, uploadId);
      } else {
        await deleteFromR2(r2Key);
      }
    } catch (cleanupErr) {
      console.error(`[upload-complete] R2 cleanup failed for key=${r2Key}:`, cleanupErr);
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
}): Promise<NextResponse> {
  const { slotId, slot, userId, actorId, r2Key, fileUrl, fileName, mimeType, sizeBytes, durationSec } = args;

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

    const trigger = version.versionNumber === 1 ? "VERSION_UPLOADED_FIRST" : "VERSION_UPLOADED_AGAIN";
    await applyAutoTransition(tx as typeof args.prisma, slotId, freshStatus, trigger, actorId);

    return version;
  });

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

  const attachment = await args.prisma.$transaction(async (tx) => {
    // Upsert le brief s'il n'existe pas encore
    const brief = await tx.publicationBrief.upsert({
      where: { slotId },
      update: { updatedByUserId: userId },
      create: { slotId, updatedByUserId: userId },
      select: { id: true },
    });

    // Insérer la pièce jointe
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

    return att;
  });

  await logActivity(args.prisma, {
    slotId,
    actorId,
    type: "BRIEF_UPDATED",
    payload: { attachmentId: attachment.id, fileName, mimeType },
  });

  return NextResponse.json({ ok: true, id: attachment.id });
}
