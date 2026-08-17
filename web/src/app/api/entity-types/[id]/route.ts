/**
 * PATCH  /api/entity-types/[id] — met à jour un type de fiche (ADMIN).
 * DELETE /api/entity-types/[id] — supprime un type custom (ADMIN).
 *
 * Types système (`isSystem=true`, ex-Bien/ex-Tournage) : seuls name/namePlural/
 * icon/fieldSchema restent éditables — visibility et les capacités structurelles
 * (hasPlanning/hasAccount/hasRushes/hasAssignees) sont figées (elles pilotent
 * `entityScope.ts` et le reste du système, un changement casserait le scoping).
 * Suppression toujours refusée pour un type système.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import {
  normalizeCustomFields,
  validateCustomFields,
  serializeCustomFields,
} from "@/lib/customFields";

const MAX_NAME = 100;

const STRUCTURAL_KEYS = ["visibility", "hasPlanning", "hasAccount", "hasRushes", "hasAssignees"] as const;

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
} as const;

function serialize(t: { fieldSchema: string; [k: string]: unknown }) {
  return { ...t, fieldSchema: normalizeCustomFields(t.fieldSchema) };
}

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const { id } = await params;

  const existing = await prisma.entityType.findUnique({
    where: { id },
    select: { id: true, isSystem: true },
  });
  if (!existing) return NextResponse.json({ error: "Type de fiche introuvable" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  if (existing.isSystem) {
    const attemptedStructural = STRUCTURAL_KEYS.filter((k) => body[k] !== undefined);
    if (attemptedStructural.length > 0) {
      return NextResponse.json(
        {
          error: `Type système : ${attemptedStructural.join(", ")} non modifiable(s) (seuls name/namePlural/icon/fieldSchema le sont)`,
        },
        { status: 400 },
      );
    }
  }

  const data: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "Un nom est requis" }, { status: 400 });
    if (name.length > MAX_NAME) {
      return NextResponse.json({ error: `Nom trop long (max ${MAX_NAME} caractères)` }, { status: 400 });
    }
    data.name = name;
  }
  if (body.namePlural !== undefined) {
    data.namePlural = typeof body.namePlural === "string" && body.namePlural.trim() ? body.namePlural.trim() : null;
  }
  if (body.icon !== undefined) {
    data.icon = typeof body.icon === "string" && body.icon.trim() ? body.icon.trim() : null;
  }
  if (body.fieldSchema !== undefined) {
    if (!Array.isArray(body.fieldSchema)) {
      return NextResponse.json({ error: "fieldSchema doit être un tableau" }, { status: 400 });
    }
    const fieldSchema = normalizeCustomFields(body.fieldSchema);
    const schemaErr = validateCustomFields(fieldSchema);
    if (schemaErr) return NextResponse.json({ error: schemaErr }, { status: 400 });
    data.fieldSchema = serializeCustomFields(fieldSchema);
  }
  if (!existing.isSystem) {
    if (body.position !== undefined) {
      data.position = typeof body.position === "number" ? body.position : 0;
    }
    if (body.hasPlanning !== undefined) data.hasPlanning = body.hasPlanning === true;
    if (body.hasAccount !== undefined) data.hasAccount = body.hasAccount === true;
    if (body.hasRushes !== undefined) data.hasRushes = body.hasRushes === true;
    if (body.hasAssignees !== undefined) data.hasAssignees = body.hasAssignees === true;
    if (body.visibility !== undefined) data.visibility = body.visibility === "team" ? "team" : "admin";

    const nextVisibility = (data.visibility as string | undefined) ?? undefined;
    const nextHasAssignees = data.hasAssignees as boolean | undefined;
    if (nextVisibility === "team") {
      const currentHasAssignees = await prisma.entityType.findUnique({
        where: { id },
        select: { hasAssignees: true },
      });
      const effectiveHasAssignees = nextHasAssignees ?? currentHasAssignees?.hasAssignees ?? false;
      if (!effectiveHasAssignees) {
        return NextResponse.json(
          { error: "Un type « équipe » doit avoir la capacité « assignés » activée" },
          { status: 400 },
        );
      }
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Aucun champ à mettre à jour" }, { status: 400 });
  }

  const updated = await prisma.entityType.update({ where: { id }, data, select: entityTypeSelect });
  return NextResponse.json(serialize(updated));
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const { id } = await params;

  const existing = await prisma.entityType.findUnique({
    where: { id },
    select: { id: true, isSystem: true, _count: { select: { entities: true } } },
  });
  if (!existing) return NextResponse.json({ error: "Type de fiche introuvable" }, { status: 404 });

  if (existing.isSystem) {
    return NextResponse.json({ error: "Un type système ne peut pas être supprimé" }, { status: 409 });
  }
  if (existing._count.entities > 0) {
    return NextResponse.json(
      { error: "Ce type a des fiches existantes : supprimez-les (ou changez leur type) avant" },
      { status: 409 },
    );
  }

  await prisma.entityType.delete({ where: { id } });
  return NextResponse.json({ deleted: true, id });
}
