/**
 * POST /api/publications/[id]/upload-cover
 *
 * Phase 2.5 — upload direct de l'image cover pour les patterns
 * coverMode=monteurUpload. Le monteur (ou un admin) dépose une image
 * (PNG/JPG/WEBP) qui devient la cover finale du slot.
 *
 * Pas d'extraction de frames, pas de pack auto. On crée un CoverFramePack
 * "pré-sélectionné" (status=SELECTED + finalCoverUrl rempli direct) lié
 * à la currentVersion s'il y en a une.
 *
 * Accès :
 *  - pattern.coverMode (ou override) doit être "monteurUpload"
 *  - role ADMIN ou MONTEUR assigné au slot
 *  - canEditBrief équivalent : si tu peux uploader une version, tu peux
 *    uploader la cover.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { toUserRole } from "@/lib/permissions/role";
import { uploadToR2, r2Configured } from "@/lib/r2";
import { isLocalStorage, writeLocalObject, getPublicUrl } from "@/lib/storage";
import { logActivity } from "@/lib/services/slot/activity";

type Params = { params: Promise<{ id: string }> };

const MAX_BYTES = 20 * 1024 * 1024; // 20 Mo
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function POST(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id: slotId } = await params;

  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: {
      id: true,
      currentVersionId: true,
      assigneeMonteurId: true,
      assigneeCmId: true,
      assigneeVideasteId: true,
      coverModeOverride: true,
      pattern: { select: { coverMode: true } },
    },
  });
  if (!slot || !canUserAccessSlot(slot, role, userId)) {
    return NextResponse.json({ error: "Publication introuvable" }, { status: 404 });
  }

  // Gate : seul le MONTEUR assigné ou l'ADMIN peut uploader la cover, et
  // uniquement si le mode résolu est monteurUpload.
  const effectiveCoverMode = slot.coverModeOverride ?? slot.pattern?.coverMode ?? "none";
  if (effectiveCoverMode !== "monteurUpload") {
    return NextResponse.json(
      { error: "Le mode cover ne permet pas l'upload manuel" },
      { status: 422 },
    );
  }
  const canUpload =
    role === "ADMIN" || (role === "MONTEUR" && slot.assigneeMonteurId === userId);
  if (!canUpload) {
    return NextResponse.json({ error: "Permission refusée" }, { status: 403 });
  }

  // Parse multipart
  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Fichier manquant" }, { status: 400 });
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: "Format non supporté (PNG, JPG ou WEBP requis)" },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Image trop volumineuse (max 20 Mo)" },
      { status: 413 },
    );
  }

  // Construit la clé R2 / disque local
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const timestamp = Date.now();
  const r2Key = `publications/${slotId}/cover-monteur/${timestamp}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    if (isLocalStorage()) {
      await writeLocalObject(r2Key, buffer);
    } else if (r2Configured()) {
      await uploadToR2(r2Key, buffer, file.type);
    } else {
      return NextResponse.json(
        { error: "Stockage non configuré (R2 absent en prod)" },
        { status: 503 },
      );
    }
  } catch (err) {
    console.error(`[upload-cover] storage write failed slot=${slotId}:`, err);
    return NextResponse.json(
      { error: "Échec écriture stockage" },
      { status: 500 },
    );
  }

  const finalCoverUrl = getPublicUrl(r2Key);

  // Cherche un pack existant lié à la version courante (si elle existe).
  // Sinon on crée un pack standalone.
  let coverPackId: string;
  if (slot.currentVersionId) {
    const existing = await prisma.coverFramePack.findUnique({
      where: { publicationVersionId: slot.currentVersionId },
      select: { id: true },
    });
    if (existing) {
      await prisma.coverFramePack.update({
        where: { id: existing.id },
        data: {
          status: "SELECTED",
          finalCoverUrl,
          finalCoverKey: r2Key,
          errorMsg: null,
        },
      });
      coverPackId = existing.id;
    } else {
      const created = await prisma.coverFramePack.create({
        data: {
          userId,
          publicationVersionId: slot.currentVersionId,
          status: "SELECTED",
          sourceVideoUrl: null,
          finalCoverUrl,
          finalCoverKey: r2Key,
          frameCount: 0,
          config: JSON.stringify({ mode: "monteurUpload" }),
        },
        select: { id: true },
      });
      coverPackId = created.id;
    }
  } else {
    // Pas de currentVersion : on crée un pack non lié. Le pack sera lié plus
    // tard si une version est promue. Edge case rare (monteurUpload sans
    // version est inhabituel — la cover est censée arriver avec la version).
    const created = await prisma.coverFramePack.create({
      data: {
        userId,
        status: "SELECTED",
        sourceVideoUrl: null,
        finalCoverUrl,
        finalCoverKey: r2Key,
        frameCount: 0,
        config: JSON.stringify({ mode: "monteurUpload", orphan: true }),
      },
      select: { id: true },
    });
    coverPackId = created.id;
  }

  await logActivity(prisma, {
    slotId,
    actorId: userContext.actualUser.id,
    type: "COVER_COMPLETED",
    payload: {
      coverFramePackId: coverPackId,
      finalCoverUrl,
      uploadedBy: "monteur",
    },
  });

  return NextResponse.json({ ok: true, coverPackId, finalCoverUrl });
}
