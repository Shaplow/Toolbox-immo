/**
 * GET    /api/admin/order-templates/[id] — détail d'un modèle de commande.
 * PATCH  /api/admin/order-templates/[id] — mise à jour (composition wholesale).
 * DELETE /api/admin/order-templates/[id] — suppression (409 si commandes).
 *
 * ADMIN only.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import {
  deleteOrderTemplate,
  getOrderTemplate,
  updateOrderTemplate,
  type OrderTemplateInput,
} from "@/lib/services/order/orderTemplateService";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";

type Params = { params: Promise<{ id: string }> };

function parseInput(body: Record<string, unknown>): OrderTemplateInput {
  return {
    name: typeof body.name === "string" ? body.name : "",
    description: typeof body.description === "string" ? body.description : null,
    position: typeof body.position === "number" ? body.position : undefined,
    isArchived: body.isArchived === true,
    items: Array.isArray(body.items)
      ? (body.items as { entityTypeId?: unknown }[]).map((i) => ({
          entityTypeId: typeof i?.entityTypeId === "string" ? i.entityTypeId : "",
        }))
      : [],
    recipes: Array.isArray(body.recipes)
      ? (body.recipes as { patternTemplateId?: unknown; count?: unknown }[]).map((r) => ({
          patternTemplateId: typeof r?.patternTemplateId === "string" ? r.patternTemplateId : "",
          count: typeof r?.count === "number" ? r.count : NaN,
        }))
      : [],
    clientIds: Array.isArray(body.clientIds)
      ? (body.clientIds as unknown[]).filter((c): c is string => typeof c === "string")
      : [],
  };
}

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const { id } = await params;
  try {
    const template = await getOrderTemplate(id);
    return NextResponse.json(template);
  } catch (err) {
    return mapServiceError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  try {
    const template = await updateOrderTemplate(id, parseInput(body));
    return NextResponse.json(template);
  } catch (err) {
    return mapServiceError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const { id } = await params;
  try {
    await deleteOrderTemplate(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return mapServiceError(err);
  }
}
