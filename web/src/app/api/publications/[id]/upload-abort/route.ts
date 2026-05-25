/**
 * POST /api/publications/[id]/upload-abort
 *
 * Annule un upload multipart en cours et libère le stockage partiel R2.
 * À appeler si l'utilisateur abandonne un upload ou si une erreur réseau survient.
 *
 * Auth : getUserContext() obligatoire.
 * Scope : canUserAccessSlot — 404 si non accessible (anti-énumération).
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { toUserRole } from "@/lib/permissions/role";
import { abortMultipartUpload } from "@/lib/r2Multipart";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  // 1. Auth
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id: slotId } = await params;

  // 2. Charger le slot (scope anti-énumération)
  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: {
      id: true,
      assigneeMonteurId: true,
      assigneeCmId: true,
    },
  });

  if (!slot || !canUserAccessSlot(slot, role, userId)) {
    return NextResponse.json({ error: "Publication introuvable" }, { status: 404 });
  }

  // 3. Parser le body
  const body = await req.json() as { r2Key?: string; uploadId?: string };
  const { r2Key, uploadId } = body;

  if (!r2Key || typeof r2Key !== "string") {
    return NextResponse.json({ error: "Le champ 'r2Key' est requis" }, { status: 400 });
  }

  if (!uploadId || typeof uploadId !== "string") {
    return NextResponse.json({ error: "Le champ 'uploadId' est requis" }, { status: 400 });
  }

  // 4. Sécurité : vérifier que la clé appartient bien au slot
  if (!r2Key.startsWith(`publications/${slotId}/`)) {
    return NextResponse.json({ error: "Clé R2 non autorisée pour ce slot" }, { status: 403 });
  }

  // 5. Aborter l'upload multipart
  try {
    await abortMultipartUpload(r2Key, uploadId);
  } catch (err) {
    console.error(`[upload-abort] abortMultipartUpload failed key=${r2Key} uploadId=${uploadId}:`, err);
    return NextResponse.json(
      { error: "Échec de l'annulation de l'upload" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
