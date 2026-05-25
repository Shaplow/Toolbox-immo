/**
 * POST /api/publications/[id]/upload-presign
 *
 * Génère des URL(s) pré-signées pour uploader un fichier directement vers R2
 * pour une publication (rush, version de montage, ou pièce jointe de brief).
 *
 * Pour les fichiers <= 100 MB : une URL PUT unique (single upload).
 * Pour les fichiers > 100 MB  : un upload multipart (N URLs pré-signées).
 *
 * Auth : getUserContext() obligatoire.
 * Scope : canUserAccessSlot — 404 si non accessible (anti-énumération).
 * Permission par kind :
 *   rush             → canUploadRushes
 *   version          → canUploadVersion
 *   brief-attachment → canEditBrief
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { canUploadRushes, canUploadVersion, canEditBrief } from "@/lib/permissions/publications";
import { toUserRole } from "@/lib/permissions/role";
import { r2Configured, createPresignedUploadUrl } from "@/lib/r2";
import { createMultipartUpload, createPresignedUploadPartUrl } from "@/lib/r2Multipart";
import { rushKey, versionKey, briefAttachmentKey } from "@/lib/r2Keys";

// ─── Constantes ────────────────────────────────────────────────────────────────

const ALLOWED_CONTENT_TYPES: Record<string, string[]> = {
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
  "brief-attachment": ["application/pdf", "image/jpeg", "image/png", "image/webp"],
};

const MAX_SIZE: Record<string, number> = {
  rush: 10 * 1024 * 1024 * 1024,           // 10 GB
  version: 10 * 1024 * 1024 * 1024,        // 10 GB
  "brief-attachment": 50 * 1024 * 1024,    // 50 MB
};

const MULTIPART_THRESHOLD = 100 * 1024 * 1024; // 100 MB
const PART_SIZE = 50 * 1024 * 1024;            // 50 MB par partie

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
      assigneeCmId: true,
    },
  });

  if (!slot || !canUserAccessSlot(slot, role, userId)) {
    return NextResponse.json({ error: "Publication introuvable" }, { status: 404 });
  }

  // 3. Parser le body
  const body = await req.json() as {
    kind?: string;
    filename?: string;
    contentType?: string;
    size?: number;
  };

  const { kind, filename, contentType, size } = body;

  if (!kind || !["rush", "version", "brief-attachment"].includes(kind)) {
    return NextResponse.json(
      { error: "Le champ 'kind' est requis et doit être : rush | version | brief-attachment" },
      { status: 400 }
    );
  }

  if (!filename || typeof filename !== "string" || !filename.trim()) {
    return NextResponse.json({ error: "Le champ 'filename' est requis" }, { status: 400 });
  }

  if (!contentType || typeof contentType !== "string") {
    return NextResponse.json({ error: "Le champ 'contentType' est requis" }, { status: 400 });
  }

  if (typeof size !== "number" || size <= 0) {
    return NextResponse.json({ error: "Le champ 'size' (octets) est requis" }, { status: 400 });
  }

  const uploadKind = kind as UploadKind;

  // 4. Vérifier le content-type
  if (!ALLOWED_CONTENT_TYPES[uploadKind].includes(contentType)) {
    return NextResponse.json(
      { error: `Type de fichier non supporté pour '${uploadKind}'` },
      { status: 400 }
    );
  }

  // 5. Vérifier la taille
  if (size > MAX_SIZE[uploadKind]) {
    const maxMB = Math.round(MAX_SIZE[uploadKind] / (1024 * 1024));
    const maxGb = maxMB >= 1024 ? `${maxMB / 1024} GB` : `${maxMB} MB`;
    return NextResponse.json(
      { error: `Fichier trop volumineux (max ${maxGb})` },
      { status: 400 }
    );
  }

  // 6. Vérifier la permission par kind
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

  // 7. Vérifier R2
  if (!r2Configured()) {
    return NextResponse.json(
      { error: "Service de stockage non configuré" },
      { status: 503 }
    );
  }

  // 8. Générer la clé R2
  let r2Key: string;
  if (uploadKind === "rush") {
    r2Key = rushKey(slotId, filename);
  } else if (uploadKind === "version") {
    // Numéro provisoire basé sur timestamp — le numéro définitif est calculé en upload-complete
    r2Key = versionKey(slotId, 0, filename);
  } else {
    r2Key = briefAttachmentKey(slotId, filename);
  }

  // 9. Single PUT vs multipart
  if (size > MULTIPART_THRESHOLD) {
    // Multipart
    const { uploadId } = await createMultipartUpload(r2Key, contentType);
    const partCount = Math.ceil(size / PART_SIZE);
    const partUrls: { partNumber: number; url: string }[] = [];

    for (let i = 1; i <= partCount; i++) {
      const url = await createPresignedUploadPartUrl(r2Key, uploadId, i);
      partUrls.push({ partNumber: i, url });
    }

    return NextResponse.json({
      multipart: {
        uploadId,
        partSize: PART_SIZE,
        partUrls,
      },
      r2Key,
    });
  } else {
    // Single PUT
    const singleUrl = await createPresignedUploadUrl(r2Key, contentType, 3600, size);
    return NextResponse.json({ singleUrl, r2Key });
  }
}
