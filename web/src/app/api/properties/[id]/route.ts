/**
 * GET /api/properties/[id] — détail d'un bien.
 * PATCH /api/properties/[id] — met à jour label / fields / fieldSchema.
 * DELETE /api/properties/[id] — archive (soft) le bien.
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

interface Params {
  params: Promise<{ id: string }>;
}

type PropertyRow = {
  id: string;
  label: string;
  fields: string;
  fieldSchema: string;
  updatedAt: Date;
  isArchived?: boolean;
};

function serialize(p: PropertyRow) {
  return {
    id: p.id,
    label: p.label,
    fields: safeJSON<Record<string, string>>(p.fields, {}),
    fieldSchema: safeJSON<string[]>(p.fieldSchema, []),
    updatedAt: p.updatedAt,
  };
}

export async function GET(_req: NextRequest, { params }: Params) {
  const ctx = await getUserContext();
  if (!ctx?.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }
  const { id } = await params;
  const property = await prisma.property.findUnique({
    where: { id },
    select: { id: true, label: true, fields: true, fieldSchema: true, updatedAt: true, isArchived: true },
  });
  if (!property || property.isArchived) {
    return NextResponse.json({ error: "Bien introuvable" }, { status: 404 });
  }
  return NextResponse.json(serialize(property));
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = await getUserContext();
  if (!ctx?.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }
  const { id } = await params;

  let body: { label?: unknown; fields?: unknown; fieldSchema?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  if (body.label !== undefined) {
    const err = validateLabel(body.label);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  }

  const fieldsErr = validateFields(body.fields);
  if (fieldsErr) return NextResponse.json({ error: fieldsErr }, { status: 400 });

  const schemaErr = validateFieldSchema(body.fieldSchema);
  if (schemaErr) return NextResponse.json({ error: schemaErr }, { status: 400 });

  const existing = await prisma.property.findUnique({
    where: { id },
    select: { id: true, isArchived: true },
  });
  if (!existing || existing.isArchived) {
    return NextResponse.json({ error: "Bien introuvable" }, { status: 404 });
  }

  const updated = await prisma.property.update({
    where: { id },
    data: {
      ...(body.label !== undefined ? { label: (body.label as string).trim() } : {}),
      ...(body.fields !== undefined ? { fields: JSON.stringify(body.fields) } : {}),
      ...(body.fieldSchema !== undefined
        ? { fieldSchema: JSON.stringify(cleanFieldSchema(body.fieldSchema as unknown[])) }
        : {}),
    },
    select: { id: true, label: true, fields: true, fieldSchema: true, updatedAt: true },
  });

  return NextResponse.json(serialize(updated));
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const ctx = await getUserContext();
  if (!ctx?.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }
  const { id } = await params;

  const existing = await prisma.property.findUnique({
    where: { id },
    select: { id: true, isArchived: true },
  });
  if (!existing || existing.isArchived) {
    return NextResponse.json({ error: "Bien introuvable" }, { status: 404 });
  }

  await prisma.property.update({ where: { id }, data: { isArchived: true } });
  return NextResponse.json({ archived: true, id });
}
