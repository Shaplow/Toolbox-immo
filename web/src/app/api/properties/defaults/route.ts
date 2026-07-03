/**
 * GET  /api/properties/defaults — modèle de champs par défaut.
 * PUT  /api/properties/defaults — met à jour le modèle.
 *
 * Admin-only. Auth via getUserContext() / canAdminBypass — jamais auth() direct.
 * Stockage : AppSetting.key = "property.defaultFieldSchema", value = JSON string[].
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import {
  normalizeCustomFields,
  validateCustomFields,
  serializeCustomFields,
} from "@/lib/customFields";

const SETTING_KEY = "property.defaultFieldSchema";

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx?.effectiveUser.id || !ctx.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const setting = await prisma.appSetting.findUnique({ where: { key: SETTING_KEY } });
  return NextResponse.json({ fieldSchema: normalizeCustomFields(setting?.value) });
}

export async function PUT(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx?.effectiveUser.id || !ctx.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  let body: { fieldSchema?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  if (body.fieldSchema !== undefined && !Array.isArray(body.fieldSchema)) {
    return NextResponse.json({ error: "fieldSchema doit être un tableau" }, { status: 400 });
  }

  const fields = normalizeCustomFields(body.fieldSchema);
  const err = validateCustomFields(fields);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  await prisma.appSetting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value: serializeCustomFields(fields) },
    update: { value: serializeCustomFields(fields) },
  });

  return NextResponse.json({ fieldSchema: fields });
}
