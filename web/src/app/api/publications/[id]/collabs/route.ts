/**
 * PUT /api/publications/[id]/collabs — comptes invités en collaborateur.
 *
 * Route dédiée et non un champ du PATCH générique, pour la même raison que
 * `/account` : `patchSlot` filtre SILENCIEUSEMENT ce qui n'est pas dans la
 * whitelist du rôle, donc un refus ne se verrait pas. Et une table de jonction
 * n'est de toute façon pas une colonne patchable.
 *
 * PUT et non POST/DELETE : on remplace le set entier, l'appel est idempotent.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { setSlotCollabs } from "@/lib/services/slot/slotService";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  if (!Array.isArray(body.accountIds)) {
    return NextResponse.json({ error: "accountIds doit être un tableau" }, { status: 400 });
  }
  const accountIds = body.accountIds.filter((v): v is string => typeof v === "string");

  try {
    const result = await setSlotCollabs(id, accountIds, userContext);
    return NextResponse.json(result);
  } catch (err) {
    return mapServiceError(err);
  }
}
