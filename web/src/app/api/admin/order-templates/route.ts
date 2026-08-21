/**
 * GET  /api/admin/order-templates — liste des modèles de bons de commande.
 * POST /api/admin/order-templates — création (composition complète).
 *
 * ADMIN only. La composition (items/recipes/clientIds) est validée dans
 * orderTemplateService (existence des références, bornes).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import {
  createOrderTemplate,
  listOrderTemplates,
  type OrderTemplateInput,
} from "@/lib/services/order/orderTemplateService";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";

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

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const { searchParams } = new URL(req.url);
  try {
    const templates = await listOrderTemplates({
      includeArchived: searchParams.get("includeArchived") === "true",
    });
    return NextResponse.json({ templates });
  } catch (err) {
    return mapServiceError(err);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  try {
    const template = await createOrderTemplate(parseInput(body));
    return NextResponse.json(template, { status: 201 });
  } catch (err) {
    return mapServiceError(err);
  }
}
