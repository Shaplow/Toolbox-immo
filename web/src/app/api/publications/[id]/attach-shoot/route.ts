/**
 * POST /api/publications/[id]/attach-shoot — rattache (ou détache) une
 * publication à une fiche tournage après sa création (ADMIN).
 *
 * Body : { shootEntityId: string | null } — `null` détache.
 *
 * Répond au cas RPOD : on ne sait pas combien de vidéos sortiront du contenu
 * tourné, donc l'admin pré-shoote des slots sur le calendrier et les relie au
 * tournage une fois le montage engagé. `shootEntityId` était write-once —
 * absent de toutes les listes de ALLOWED_PATCH_FIELDS_BY_ROLE, ADMIN compris.
 *
 * Route dédiée plutôt qu'un champ patchable : le rattachement revalide en
 * cascade le compte, la fiche liée, les assignés et needsRushesOverride
 * (cf. attachShootToSlot).
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { attachShootToSlot } from "@/lib/services/slot/slotService";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { shootEntityId?: unknown };

  // `null` est une valeur MÉTIER (détacher), pas une absence : distinguer les
  // deux, sinon un body vide détacherait le tournage par accident.
  if (!("shootEntityId" in body)) {
    return NextResponse.json({ error: "shootEntityId requis (ou null)" }, { status: 400 });
  }
  const shootEntityId = body.shootEntityId;
  if (shootEntityId !== null && typeof shootEntityId !== "string") {
    return NextResponse.json({ error: "shootEntityId invalide" }, { status: 400 });
  }

  try {
    const slot = await attachShootToSlot(id, shootEntityId, userContext);
    return NextResponse.json({ ok: true, slot });
  } catch (err) {
    return mapServiceError(err);
  }
}
