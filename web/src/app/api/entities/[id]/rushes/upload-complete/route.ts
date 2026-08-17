/**
 * POST /api/entities/[id]/rushes/upload-complete
 *
 * Finalise un upload de rush au niveau FICHE (single PUT ou multipart) et
 * insère un PublicationRush{ entityId, slotId:null }. Au PREMIER rush, la fiche
 * passe PLANNED → SHOT (markEntityShot) et les reels attachés PLANNED/RUSHES_EXPECTED
 * sont bumpés vers IN_EDIT. Miroir de shoot-events/[id]/rushes/upload-complete.
 *
 * Auth : getUserContext(). Permission : canUploadEntityRushes.
 * Garde anti cross-scope : la clé doit commencer par `entities/{entityId}/`.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import { canUploadEntityRushes } from "@/lib/permissions/entityScope";
import { toUserRole } from "@/lib/permissions/role";
import { objectExists, deleteObject, isLocalStorage } from "@/lib/storage";
import { completeMultipartUpload, abortMultipartUpload } from "@/lib/r2Multipart";
import { logEntityActivity } from "@/lib/services/entity/entityActivity";
import { markEntityShot } from "@/lib/services/entity/entityService";
import { loadEntityForAccess } from "@/lib/services/entity/entityAccess";

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
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const actorId = userContext.actualUser.id;
  const { id: entityId } = await params;

  const entity = await loadEntityForAccess(entityId);
  if (!entity || !canUploadEntityRushes(entity, role, userId)) {
    return NextResponse.json({ error: "Fiche introuvable" }, { status: 404 });
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
  // Garde anti cross-scope : la clé doit appartenir à CETTE fiche.
  if (!r2Key.startsWith(`entities/${entityId}/`)) {
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
      console.error(`[entity upload-complete] completeMultipartUpload failed key=${r2Key}:`, err);
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
          entityId,
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
        where: { entityId, deletedAt: null },
      });

      await logEntityActivity(tx, {
        entityId,
        actorId,
        type: "RUSHES_UPLOADED",
        payload: { rushId: created.id, fileName, mimeType },
      });

      // Premier rush → le tournage est réalisé : SHOT + bump des reels.
      if (rushCount === 1) {
        await markEntityShot(tx, entityId, actorId);
      }

      return created;
    });

    return NextResponse.json({ ok: true, id: rush.id });
  } catch (err) {
    console.error(`[entity upload-complete] Prisma insert failed, cleanup key=${r2Key}:`, err);
    try {
      if (isMultipart && uploadId && !isLocalStorage()) {
        await abortMultipartUpload(r2Key, uploadId);
      } else {
        await deleteObject(r2Key);
      }
    } catch (cleanupErr) {
      console.error(`[entity upload-complete] cleanup failed key=${r2Key}:`, cleanupErr);
    }
    return NextResponse.json(
      { error: "Erreur lors de l'enregistrement. L'upload a été annulé." },
      { status: 500 },
    );
  }
}
