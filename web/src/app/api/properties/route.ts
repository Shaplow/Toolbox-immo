/**
 * GET /api/properties — liste des biens non archivés.
 * POST /api/properties — crée un nouveau bien.
 *
 * Admin-only. Auth via getUserContext() / canAdminBypass — jamais auth() direct.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { safeJSON } from "@/lib/utils/json";

const MAX_LABEL = 200;
const MAX_KEY = 100;
const MAX_VALUE = 5000;

function validateLabel(label: unknown): string | null {
  if (typeof label !== "string" || !label.trim()) return "label requis";
  if (label.trim().length > MAX_LABEL) return `label trop long (max ${MAX_LABEL} caractères)`;
  return null;
}

function validateFields(fields: unknown): string | null {
  if (fields === undefined) return null;
  if (typeof fields !== "object" || fields === null || Array.isArray(fields)) {
    return "fields doit être un objet";
  }
  const obj = fields as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (key.length > MAX_KEY) return `Clé fields trop longue (max ${MAX_KEY}): ${key.slice(0, 20)}…`;
    if (typeof value !== "string" || value.length > MAX_VALUE) {
      return `Valeur fields["${key}"] doit être string ≤${MAX_VALUE} chars`;
    }
  }
  return null;
}

function validateFieldSchema(fieldSchema: unknown): string | null {
  if (fieldSchema === undefined) return null;
  if (!Array.isArray(fieldSchema)) return "fieldSchema doit être un tableau";
  for (const f of fieldSchema as unknown[]) {
    if (typeof f !== "string" || !(f as string).trim()) {
      return "fieldSchema : chaque champ doit être une chaîne non vide";
    }
  }
  return null;
}

function cleanFieldSchema(raw: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const f of raw) {
    const s = (f as string).trim();
    if (s && !seen.has(s)) {
      seen.add(s);
      result.push(s);
    }
  }
  return result;
}

export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx?.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();

  const properties = await prisma.property.findMany({
    where: {
      isArchived: false,
      ...(q ? { label: { contains: q, mode: "insensitive" } } : {}),
    },
    select: {
      id: true,
      label: true,
      fieldSchema: true,
      updatedAt: true,
      _count: { select: { slots: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json(
    properties.map((p) => ({
      ...p,
      fieldSchema: safeJSON<string[]>(p.fieldSchema, []),
    })),
  );
}

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx?.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  let body: { label?: unknown; fields?: unknown; fieldSchema?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  const labelErr = validateLabel(body.label);
  if (labelErr) return NextResponse.json({ error: labelErr }, { status: 400 });

  const fieldsErr = validateFields(body.fields);
  if (fieldsErr) return NextResponse.json({ error: fieldsErr }, { status: 400 });

  const schemaErr = validateFieldSchema(body.fieldSchema);
  if (schemaErr) return NextResponse.json({ error: schemaErr }, { status: 400 });

  const cleanSchema = body.fieldSchema
    ? cleanFieldSchema(body.fieldSchema as unknown[])
    : [];

  const created = await prisma.property.create({
    data: {
      label: (body.label as string).trim(),
      fields: body.fields !== undefined ? JSON.stringify(body.fields) : "{}",
      fieldSchema: JSON.stringify(cleanSchema),
      createdByUserId: ctx.actualUser.id,
    },
  });

  return NextResponse.json(
    {
      ...created,
      fields: safeJSON<Record<string, string>>(created.fields, {}),
      fieldSchema: safeJSON<string[]>(created.fieldSchema, []),
    },
    { status: 201 },
  );
}
