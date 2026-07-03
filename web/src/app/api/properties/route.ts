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
import {
  normalizeCustomFields,
  validateCustomFields,
  serializeCustomFields,
} from "@/lib/customFields";

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

/** Normalise + valide un fieldSchema (accepte le legacy string[] ET CustomField[]). */
function parseFieldSchema(raw: unknown): { fields: ReturnType<typeof normalizeCustomFields>; error: string | null } {
  if (raw !== undefined && !Array.isArray(raw)) {
    return { fields: [], error: "fieldSchema doit être un tableau" };
  }
  const fields = normalizeCustomFields(raw);
  return { fields, error: validateCustomFields(fields) };
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
      fieldSchema: normalizeCustomFields(p.fieldSchema),
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

  const { fields: providedSchema, error: schemaErr } = parseFieldSchema(body.fieldSchema);
  if (schemaErr) return NextResponse.json({ error: schemaErr }, { status: 400 });

  // Si aucun fieldSchema fourni (ou vide), on hérite du modèle par défaut.
  let schema = providedSchema;
  if (schema.length === 0) {
    const defaultSetting = await prisma.appSetting.findUnique({
      where: { key: "property.defaultFieldSchema" },
    });
    schema = normalizeCustomFields(defaultSetting?.value);
  }

  const created = await prisma.property.create({
    data: {
      label: (body.label as string).trim(),
      fields: body.fields !== undefined ? JSON.stringify(body.fields) : "{}",
      fieldSchema: serializeCustomFields(schema),
      createdByUserId: ctx.actualUser.id,
    },
  });

  return NextResponse.json(
    {
      ...created,
      fields: safeJSON<Record<string, string>>(created.fields, {}),
      fieldSchema: normalizeCustomFields(created.fieldSchema),
    },
    { status: 201 },
  );
}
