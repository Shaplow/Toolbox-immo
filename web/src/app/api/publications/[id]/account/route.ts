/**
 * POST /api/publications/[id]/account — pose (ou change) le compte Instagram
 * d'une publication déjà créée (ADMIN).
 *
 * Body : { accountId: string }
 *
 * Le compte n'est plus choisi à la commande — « une vidéo pourrait atterrir
 * parfois sur plusieurs comptes » — mais par celui qui place au calendrier.
 * Les publications naissent donc en banque sans compte, un état que la base
 * accepte depuis toujours (`accountId` nullable) mais dont rien ne permettait
 * de sortir : `accountId` est absent de ALLOWED_PATCH_FIELDS_BY_ROLE, et
 * `patchSlot` filtre SILENCIEUSEMENT ce qui n'y figure pas.
 *
 * Route dédiée plutôt qu'un champ patchable, comme `/attach-shoot` : poser un
 * compte re-résout le binding (recette effective, horaires, libellé) et
 * complète les assignés (cf. assignSlotAccount).
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { assignSlotAccount } from "@/lib/services/slot/slotService";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { accountId?: unknown };

  // Pas de `null` accepté ici, contrairement à /attach-shoot : retirer le
  // compte d'une publication déjà placée la ferait disparaître du calendrier
  // sans que rien ne le signale. On pose, on ne dépose pas.
  if (typeof body.accountId !== "string" || !body.accountId) {
    return NextResponse.json({ error: "accountId requis" }, { status: 400 });
  }

  try {
    const slot = await assignSlotAccount(id, body.accountId, userContext);
    return NextResponse.json({ ok: true, slot });
  } catch (err) {
    return mapServiceError(err);
  }
}
