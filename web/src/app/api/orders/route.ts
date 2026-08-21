/**
 * GET  /api/orders — liste des commandes (scopée : admin tout, externe son client).
 * POST /api/orders — soumission d'un bon de commande (externe rattaché, ou
 *   admin avec clientId explicite).
 *
 * Auth : requireUser. Le scoping + les whitelists vivent dans orderService
 * (clientId TOUJOURS dérivé de la session pour un externe, jamais du body).
 * Rate limit best-effort par user sur le POST (pattern data-fill).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import {
  createOrder,
  listOrders,
  type CreateOrderInput,
} from "@/lib/services/order/orderService";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const rateLimits = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(key);
  if (!entry || entry.resetAt < now) {
    rateLimits.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) return false;
  entry.count++;
  return true;
}

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  const { searchParams } = new URL(req.url);
  try {
    const orders = await listOrders(
      {
        status: searchParams.get("status"),
        clientId: searchParams.get("clientId"),
      },
      auth.ctx,
    );
    return NextResponse.json({ orders });
  } catch (err) {
    return mapServiceError(err);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  if (!checkRateLimit(auth.ctx.actualUser.id)) {
    return NextResponse.json(
      { error: "Trop de requêtes — réessayez dans une minute" },
      { status: 429 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const input: CreateOrderInput = {
    orderTemplateId: typeof body.orderTemplateId === "string" ? body.orderTemplateId : "",
    accountId: typeof body.accountId === "string" && body.accountId ? body.accountId : null,
    notes: typeof body.notes === "string" ? body.notes : null,
    clientId: typeof body.clientId === "string" && body.clientId ? body.clientId : null,
    fiches: Array.isArray(body.fiches)
      ? (body.fiches as Record<string, unknown>[]).map((f) => ({
          entityTypeId: typeof f?.entityTypeId === "string" ? f.entityTypeId : "",
          label: typeof f?.label === "string" ? f.label : "",
          fields:
            f?.fields !== undefined && typeof f.fields === "object" && f.fields !== null
              ? (f.fields as Record<string, string>)
              : undefined,
          scheduledAt:
            typeof f?.scheduledAt === "string" && f.scheduledAt ? f.scheduledAt : null,
        }))
      : [],
  };

  try {
    const order = await createOrder(input, auth.ctx);
    return NextResponse.json(order, { status: 201 });
  } catch (err) {
    return mapServiceError(err);
  }
}
