/**
 * POST /api/entities/[id]/slots — attache un/des slot(s) à une fiche.
 *
 * Fusion de `properties/[id]/missions` (fiche admin, ex-Bien : N recettes → N
 * PublicationSlot en une fois) et `shoot-events/[id]/reels` (fiche team,
 * ex-Tournage : un reel attaché au tournage). Le chemin effectif est déterminé
 * par `entityService.attachSlotToEntity` selon les capacités du type
 * (hasPlanning && hasRushes → reel, sinon → missions).
 *
 * Auth : getUserContext(). Gating dans entityService.attachSlotToEntity.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import {
  attachSlotToEntity,
  type AttachSlotToEntityInput,
} from "@/lib/services/entity/entityService";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;
  const { id: entityId } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

  const input: AttachSlotToEntityInput = {
    // Chemin missions.
    recipeIds: Array.isArray(body.recipeIds)
      ? body.recipeIds.filter((r): r is string => typeof r === "string" && !!r)
      : undefined,
    accountId: str(body.accountId),
    // Chemin reel.
    patternBindingId: str(body.patternBindingId),
    patternTemplateId: str(body.patternTemplateId),
    scheduledAt: str(body.scheduledAt),
    title: str(body.title),
    description: str(body.description),
    propertyId: str(body.propertyId),
    assigneeMonteurId: str(body.assigneeMonteurId),
    assigneeCmId: str(body.assigneeCmId),
    assigneeVideasteId: str(body.assigneeVideasteId),
  };

  try {
    const result = await attachSlotToEntity(entityId, input, userContext);
    return NextResponse.json(result);
  } catch (err) {
    return mapServiceError(err);
  }
}
