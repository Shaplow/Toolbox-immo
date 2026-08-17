/**
 * GET    /api/entities/[id] — détail d'une fiche (scopée, 404 anti-énum).
 * PATCH  /api/entities/[id] — mise à jour (champs filtrés par rôle).
 * DELETE /api/entities/[id] — suppression (ADMIN réel, refuse si slots attachés).
 *
 * Auth : getUserContext(). Gating dans entityService/entityScope.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { deleteEntity, getEntity, patchEntity } from "@/lib/services/entity/entityService";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;
  const { id } = await params;
  try {
    const entity = await getEntity(id, userContext);
    return NextResponse.json({ entity });
  } catch (err) {
    return mapServiceError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  try {
    const entity = await patchEntity(id, body, userContext);
    return NextResponse.json(entity);
  } catch (err) {
    return mapServiceError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;
  const { id } = await params;
  try {
    const result = await deleteEntity(id, userContext);
    return NextResponse.json(result);
  } catch (err) {
    return mapServiceError(err);
  }
}
