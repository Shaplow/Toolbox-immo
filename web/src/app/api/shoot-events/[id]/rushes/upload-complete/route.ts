/**
 * POST /api/shoot-events/[id]/rushes/upload-complete
 *
 * Finalise un upload de rush au niveau ÉVÉNEMENT (single PUT ou multipart) et
 * insère un PublicationRush{ eventId, slotId:null }. Au PREMIER rush, l'événement
 * passe PLANNED → SHOT (markEventShot) et les reels attachés PLANNED/RUSHES_EXPECTED
 * sont bumpés vers IN_EDIT. Miroir de handleRushComplete (slot).
 *
 * Auth : getUserContext(). Permission : canUploadEventRushes.
 * Garde anti cross-scope : la clé doit commencer par `shoot-events/{eventId}/`.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { canUploadEventRushes } from "@/lib/permissions/eventScope";
import { toUserRole } from "@/lib/permissions/role";
import { objectExists, deleteObject, isLocalStorage } from "@/lib/storage";
import { completeMultipartUpload, abortMultipartUpload } from "@/lib/r2Multipart";
import { logEventActivity } from "@/lib/services/event/eventActivity";
import { markEventShot } from "@/lib/services/event/eventService";
import { loadEventForAccess } from "@/lib/services/event/eventRushAccess";

const ALLOWED_MIME_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/x-m4v",
  "video/webm",
  "image/jpeg",
  "image/png",
  "image/webp",
];

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const actorId = userContext.actualUser.id;
  const { id: eventId } = await params;

  const event = await loadEventForAccess(eventId);
  if (!event || !canUploadEventRushes(event, role, userId)) {
    return NextResponse.json({ error: "Événement introuvable" }, { status: 404 });
  }

  const body = (await req.json()) as {
    r2Key?: string;
    uploadId?: string;
    parts?: { partNumber: number }[];
    fileName?: string;
    mimeType?: string;
    sizeBytes?: number;
    durationSec?: number;
  };
  const { r2Key, uploadId, parts, fileName, mimeType, sizeBytes, durationSec } = body;

  if (!r2Key || typeof r2Key !== "string") {
    return NextResponse.json({ error: "Le champ 'r2Key' est requis" }, { status: 400 });
  }
  // Garde anti cross-scope : la clé doit appartenir à CET événement.
  if (!r2Key.startsWith(`shoot-events/${eventId}/`)) {
    return NextResponse.json({ error: "Permission refusée" }, { status: 403 });
  }
  if (!fileName || typeof fileName !== "string") {
    return NextResponse.json({ error: "Le champ 'fileName' est requis" }, { status: 400 });
  }
  if (!mimeType || typeof mimeType !== "string" || !ALLOWED_MIME_TYPES.includes(mimeType)) {
    return NextResponse.json({ error: `mimeType non supporté : ${mimeType}` }, { status: 400 });
  }

  const isMultipart = !!(uploadId && parts && Array.isArray(parts) && parts.length > 0);

  // Finaliser l'upload R2.
  if (isMultipart) {
    try {
      await completeMultipartUpload(r2Key, uploadId!, parts!);
    } catch (err) {
      console.error(`[event upload-complete] completeMultipartUpload failed key=${r2Key}:`, err);
      return NextResponse.json({ error: "Échec de la finalisation de l'upload" }, { status: 500 });
    }
  } else {
    const exists = await objectExists(r2Key);
    if (!exists) {
      return NextResponse.json(
        { error: "Le fichier n'est pas encore disponible. Vérifiez que l'upload est terminé." },
        { status: 400 },
      );
    }
  }

  try {
    const rush = await prisma.$transaction(async (tx) => {
      const created = await tx.publicationRush.create({
        data: {
          eventId,
          slotId: null,
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
        where: { eventId, deletedAt: null },
      });

      await logEventActivity(tx, {
        eventId,
        actorId,
        type: "EVENT_RUSHES_UPLOADED",
        payload: { rushId: created.id, fileName, mimeType },
      });

      // Premier rush → le tournage est réalisé : SHOT + bump des reels.
      if (rushCount === 1) {
        await markEventShot(tx, eventId, actorId);
      }

      return created;
    });

    return NextResponse.json({ ok: true, id: rush.id });
  } catch (err) {
    console.error(`[event upload-complete] Prisma insert failed, cleanup key=${r2Key}:`, err);
    try {
      if (isMultipart && uploadId && !isLocalStorage()) {
        await abortMultipartUpload(r2Key, uploadId);
      } else {
        await deleteObject(r2Key);
      }
    } catch (cleanupErr) {
      console.error(`[event upload-complete] cleanup failed key=${r2Key}:`, cleanupErr);
    }
    return NextResponse.json(
      { error: "Erreur lors de l'enregistrement. L'upload a été annulé." },
      { status: 500 },
    );
  }
}
