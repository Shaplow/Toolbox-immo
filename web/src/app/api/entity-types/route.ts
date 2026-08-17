/**
 * GET  /api/entity-types — liste des types de fiche.
 * POST /api/entity-types — crée un type custom (ADMIN).
 *
 * Auth : getUserContext(). GET est ouvert à tous les rôles connectés — les
 * non-admins ne voient que les types `visibility="team"` (ex-Tournage) : les
 * types `admin` (ex-Bien) restent invisibles pour eux (cohérent avec
 * `entityScope.whereClauseForUserEntity`).
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import {
  normalizeCustomFields,
  validateCustomFields,
  serializeCustomFields,
} from "@/lib/customFields";

const MAX_NAME = 100;

const entityTypeSelect = {
  id: true,
  name: true,
  namePlural: true,
  icon: true,
  fieldSchema: true,
  hasPlanning: true,
  hasAccount: true,
  hasRushes: true,
  hasAssignees: true,
  visibility: true,
  position: true,
  isSystem: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { entities: true } },
} as const;

function serialize(t: { fieldSchema: string; [k: string]: unknown }) {
  return { ...t, fieldSchema: normalizeCustomFields(t.fieldSchema) };
}

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const types = await prisma.entityType.findMany({
    where: ctx.canAdminBypass ? {} : { visibility: "team" },
    orderBy: { position: "asc" },
    select: entityTypeSelect,
  });

  return NextResponse.json({ types: types.map(serialize) });
}

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx?.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Un nom est requis" }, { status: 400 });
  if (name.length > MAX_NAME) {
    return NextResponse.json({ error: `Nom trop long (max ${MAX_NAME} caractères)` }, { status: 400 });
  }

  if (body.fieldSchema !== undefined && !Array.isArray(body.fieldSchema)) {
    return NextResponse.json({ error: "fieldSchema doit être un tableau" }, { status: 400 });
  }
  const fieldSchema = normalizeCustomFields(body.fieldSchema);
  const schemaErr = validateCustomFields(fieldSchema);
  if (schemaErr) return NextResponse.json({ error: schemaErr }, { status: 400 });

  const visibility = body.visibility === "team" ? "team" : "admin";
  const hasAssignees = body.hasAssignees === true;
  // Garde-fou : un type team DOIT avoir hasAssignees=true (sinon son scope
  // serait vide pour toute l'équipe — cf. entityScope.ts).
  if (visibility === "team" && !hasAssignees) {
    return NextResponse.json(
      { error: "Un type « équipe » doit avoir la capacité « assignés » activée" },
      { status: 400 },
    );
  }

  const position =
    typeof body.position === "number" ? body.position : await prisma.entityType.count();

  const created = await prisma.entityType.create({
    data: {
      name,
      namePlural: typeof body.namePlural === "string" && body.namePlural.trim() ? body.namePlural.trim() : null,
      icon: typeof body.icon === "string" && body.icon.trim() ? body.icon.trim() : null,
      fieldSchema: serializeCustomFields(fieldSchema),
      hasPlanning: body.hasPlanning === true,
      hasAccount: body.hasAccount === true,
      hasRushes: body.hasRushes === true,
      hasAssignees,
      visibility,
      position,
      isSystem: false,
    },
    select: entityTypeSelect,
  });

  return NextResponse.json(serialize(created), { status: 201 });
}
