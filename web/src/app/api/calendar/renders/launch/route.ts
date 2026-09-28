/**
 * POST /api/calendar/renders/launch
 *
 * Lancement d'un lot de rendus depuis le calendrier — admin only.
 * Body : { items: BulkRenderLaunchItem[] }
 *
 * Les items sont les picks EXACTS validés côté client depuis l'aperçu
 * (`POST /api/calendar/renders/preview`), éventuellement modifiés via
 * « Changer » — le serveur ne re-tire JAMAIS un média (voir
 * `types/bulkRender.ts`, `bulkRenderService.ts`).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { launchBulkRenders } from "@/lib/services/render/bulkRenderService";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";
import type { BulkRenderLaunchItem } from "@/types/bulkRender";

function isValidItem(item: unknown): item is BulkRenderLaunchItem {
  if (!item || typeof item !== "object") return false;
  const it = item as Record<string, unknown>;
  if (typeof it.slotId !== "string" || !it.slotId) return false;
  if (typeof it.videoAssets !== "object" || it.videoAssets === null || Array.isArray(it.videoAssets)) return false;
  if (!Object.values(it.videoAssets as Record<string, unknown>).every((v) => typeof v === "string")) return false;
  if (it.audioAssetId !== undefined && it.audioAssetId !== null && typeof it.audioAssetId !== "string") return false;
  if (it.dataEntryId !== undefined && it.dataEntryId !== null && typeof it.dataEntryId !== "string") return false;
  if (!Array.isArray(it.changedBlockIds) || !it.changedBlockIds.every((id) => typeof id === "string")) return false;
  return true;
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const ctx = auth.ctx;

  let body: { items?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  // `req.json()` accepte `null`/un tableau/un scalaire — `body.items`
  // planterait alors avec un TypeError non catché (500 au lieu du 400 voulu).
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  if (!Array.isArray(body.items) || !body.items.every(isValidItem)) {
    return NextResponse.json({ error: "items (BulkRenderLaunchItem[]) requis" }, { status: 400 });
  }

  try {
    const result = await launchBulkRenders(body.items, ctx);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return mapServiceError(err);
  }
}
