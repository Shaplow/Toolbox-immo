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
import { execFile } from "child_process";
import { promisify } from "util";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { objectExistsInR2, r2Configured } from "@/lib/r2";

const execFileAsync = promisify(execFile);

type Params = { params: Promise<{ assetId: string }> };

export async function PATCH(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
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

  // Probe duration for audio assets (fire-and-forget on failure — never blocks the upload).
  if (asset.mimeType.startsWith("audio/") && asset.duration == null) {
    const duration = await probeDuration(asset.url);
    if (duration != null) {
      await prisma.mediaAsset.update({ where: { id: assetId }, data: { duration } }).catch((e) => {
        console.warn(`[confirm] duration update failed for asset ${assetId}:`, e);
      });
    } else {
      console.warn(`[confirm] duration probe failed for audio asset ${assetId} (${asset.filename})`);
    }
  }

  return NextResponse.json({ ok: true, assetId });
}

async function probeDurationFromRenderEngine(url: string): Promise<number | null> {
  const renderEngineUrl = process.env.CAPTIONS_API_URL ?? "http://localhost:8000";
  try {
    const res = await fetch(`${renderEngineUrl}/api/probe-duration`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(35_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { duration: number | null };
    return typeof data.duration === "number" ? data.duration : null;
  } catch {
    return null;
  }
}

async function probeDuration(url: string): Promise<number | null> {
  // Try local ffprobe first (available on prod server after `apt install ffmpeg`)
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "json", url],
      { timeout: 30_000 },
    );
    const d = parseFloat((JSON.parse(stdout) as { format?: { duration?: string } }).format?.duration ?? "");
    if (!isNaN(d) && d > 0) return d;
  } catch { /* ffprobe not installed — fall through */ }

  // Fallback: ask the local render-engine (works in Docker dev, no-op in prod without one)
  return probeDurationFromRenderEngine(url);
}
