/**
 * PUT /api/entities/[id]/brief/upload-local?r2Key=<key>
 *
 * Repli DEV quand R2 n'est pas configuré : le client envoie le fichier brut en
 * corps de requête, exactement comme vers une URL pré-signée. Miroir de
 * `publications/[id]/upload-local`, restreint au brief de fiche.
 *
 * En prod, ou dès que R2 est configuré : 503. Cette route n'a pas vocation à
 * coexister avec R2.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { canEditEntityBrief, canUserAccessEntity } from "@/lib/permissions/entityScope";
import { toUserRole } from "@/lib/permissions/role";
import { isLocalStorage, writeLocalObject } from "@/lib/storage";
import { loadEntityForAccess } from "@/lib/services/entity/entityAccess";
import { UPLOAD_LIMITS, tooLargeMessage } from "@/lib/upload/limits";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  if (!isLocalStorage()) {
    return NextResponse.json(
      { error: "Repli local désactivé (R2 configuré ou production)" },
      { status: 503 },
    );
  }

  const auth = await requireUser();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id: entityId } = await params;

  const entity = await loadEntityForAccess(entityId);
  if (
    !entity ||
    !canUserAccessEntity(entity, role, userId) ||
    !canEditEntityBrief(role)
  ) {
    return NextResponse.json({ error: "Fiche introuvable" }, { status: 404 });
  }

  const r2Key = req.nextUrl.searchParams.get("r2Key");
  // Anti cross-fiche : la clé doit appartenir à CETTE fiche, et au brief.
  if (!r2Key || !r2Key.startsWith(`entities/${entityId}/brief/`)) {
    return NextResponse.json({ error: "Clé de stockage invalide" }, { status: 400 });
  }

  const buffer = Buffer.from(await req.arrayBuffer());
  if (buffer.byteLength === 0) {
    return NextResponse.json({ error: "Fichier vide" }, { status: 400 });
  }
  if (buffer.byteLength > UPLOAD_LIMITS.BRIEF_ATTACHMENT_MAX_BYTES) {
    return NextResponse.json(
      { error: tooLargeMessage(UPLOAD_LIMITS.BRIEF_ATTACHMENT_MAX_BYTES) },
      { status: 400 },
    );
  }

  await writeLocalObject(r2Key, buffer);
  return NextResponse.json({ ok: true });
}
