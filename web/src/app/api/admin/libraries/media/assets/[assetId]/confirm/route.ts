/**
 * PATCH /api/admin/libraries/media/assets/[assetId]/confirm
 *
 * Called by the client after a successful PUT to R2 to confirm that the upload
 * completed. Verifies the object exists in R2.
 *
 * If the file is not found in R2 (upload was interrupted or never completed),
 * the phantom MediaAsset row is deleted and 404 is returned.
 * The client should surface this error so the admin can retry the upload.
 *
 * In dev (R2 not configured): always returns 200.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { objectExistsInR2, r2Configured } from "@/lib/r2";

type Params = { params: Promise<{ assetId: string }> };

export async function PATCH(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { assetId } = await params;

  const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
  if (!asset) {
    return NextResponse.json({ error: "Asset introuvable" }, { status: 404 });
  }

  // Dev: R2 not configured, accept unconditionally.
  if (!r2Configured() || !asset.r2Key) {
    return NextResponse.json({ ok: true, assetId });
  }

  let exists: boolean;
  try {
    exists = await objectExistsInR2(asset.r2Key);
  } catch (err) {
    console.error(`[confirm] R2 existence check failed for asset ${assetId}:`, err);
    return NextResponse.json({ error: "Impossible de vérifier l'upload R2" }, { status: 502 });
  }

  if (!exists) {
    // Upload never completed — delete the phantom row so it cannot enter the rotation.
    await prisma.mediaAsset.delete({ where: { id: assetId } }).catch((e) => {
      console.error(`[confirm] cleanup phantom asset ${assetId}:`, e);
    });
    return NextResponse.json(
      { error: "Fichier introuvable dans R2 — upload incomplet ou interrompu" },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true, assetId });
}
