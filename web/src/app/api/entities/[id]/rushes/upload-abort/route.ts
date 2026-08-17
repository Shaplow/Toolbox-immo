/**
 * POST /api/entities/[id]/rushes/upload-abort
 *
 * Annule un upload multipart en cours (rush fiche) et libère le stockage
 * partiel R2. Auth : getUserContext(). Permission : canUploadEntityRushes.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { canUploadEntityRushes } from "@/lib/permissions/entityScope";
import { toUserRole } from "@/lib/permissions/role";
import { abortMultipartUpload } from "@/lib/r2Multipart";
import { loadEntityForAccess } from "@/lib/services/entity/entityAccess";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id: entityId } = await params;

  const entity = await loadEntityForAccess(entityId);
  if (!entity || !canUploadEntityRushes(entity, role, userId)) {
    return NextResponse.json({ error: "Fiche introuvable" }, { status: 404 });
  }

  const body = (await req.json()) as { r2Key?: string; uploadId?: string };
  const { r2Key, uploadId } = body;

  if (!r2Key || typeof r2Key !== "string") {
    return NextResponse.json({ error: "Le champ 'r2Key' est requis" }, { status: 400 });
  }
  if (!uploadId || typeof uploadId !== "string") {
    return NextResponse.json({ error: "Le champ 'uploadId' est requis" }, { status: 400 });
  }
  if (!r2Key.startsWith(`entities/${entityId}/`)) {
    return NextResponse.json({ error: "Clé R2 non autorisée pour cette fiche" }, { status: 403 });
  }

  try {
    await abortMultipartUpload(r2Key, uploadId);
  } catch (err) {
    console.error(`[entity upload-abort] failed key=${r2Key} uploadId=${uploadId}:`, err);
    return NextResponse.json({ error: "Échec de l'annulation de l'upload" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
