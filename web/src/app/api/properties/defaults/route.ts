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
import { safeJSON } from "@/lib/utils/json";

const SETTING_KEY = "property.defaultFieldSchema";

function cleanFieldSchema(raw: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const f of raw) {
    if (typeof f !== "string") continue;
    const s = f.trim();
    if (s && !seen.has(s)) {
      seen.add(s);
      result.push(s);
    }
  }
  return result;
}

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx?.effectiveUser.id || !ctx.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const setting = await prisma.appSetting.findUnique({ where: { key: SETTING_KEY } });
  const fieldSchema = setting ? safeJSON<string[]>(setting.value, []) : [];

  return NextResponse.json({ fieldSchema });
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

  if (!Array.isArray(body.fieldSchema)) {
    return NextResponse.json({ error: "fieldSchema doit être un tableau" }, { status: 400 });
  }

  for (const f of body.fieldSchema as unknown[]) {
    if (typeof f !== "string") {
      return NextResponse.json(
        { error: "fieldSchema : chaque champ doit être une chaîne" },
        { status: 400 },
      );
    }
  }

  const cleaned = cleanFieldSchema(body.fieldSchema as unknown[]);

  await prisma.appSetting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value: JSON.stringify(cleaned) },
    update: { value: JSON.stringify(cleaned) },
  });

  return NextResponse.json({ fieldSchema: cleaned });
}
