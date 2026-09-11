/**
 * PATCH  /api/entity-types/[id] — met à jour un type de fiche (ADMIN).
 * DELETE /api/entity-types/[id] — supprime un type custom (ADMIN).
 *
 * Aucun type n'est verrouillé : les types seedés (ex-Bien/ex-Tournage) s'éditent
 * et se suppriment comme les types custom. Restent les gardes métier : un type
 * « équipe » exige la capacité « assignés », et un type encore référencé (fiches
 * existantes, modèle de commande) refuse la suppression.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import {
  normalizeCustomFields,
  validateCustomFields,
  serializeCustomFields,
} from "@/lib/customFields";
import { findUnknownTemplateKeys } from "@/lib/entityLabel";

const MAX_NAME = 100;
const MAX_LABEL_TEMPLATE = 500;

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
  labelTemplate: true,
  visibility: true,
  needsAdminValidation: true,
  needsClientValidation: true,
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
    select: { id: true, fieldSchema: true, labelTemplate: true, hasAssignees: true },
  });
  if (!existing) return NextResponse.json({ error: "Type de fiche introuvable" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
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
  // Déclenchée dès que L'UN DES DEUX bouge — pas seulement le modèle.
  // Un PATCH qui n'envoie que `fieldSchema`, amputé d'une clé référencée,
  // laissait sinon le modèle existant pointer dans le vide : le libellé
  // s'ampute en silence, au pire jusqu'au repli daté, et on ne le découvre que
  // sur une fiche déjà mal nommée.
  if (body.labelTemplate !== undefined || body.fieldSchema !== undefined) {
    const raw =
      body.labelTemplate !== undefined
        ? typeof body.labelTemplate === "string"
          ? body.labelTemplate.trim()
          : ""
        : (existing.labelTemplate ?? "").trim();
    if (raw.length > MAX_LABEL_TEMPLATE) {
      return NextResponse.json(
        { error: `Modèle de libellé trop long (max ${MAX_LABEL_TEMPLATE} caractères)` },
        { status: 400 },
      );
    }
    // Validé contre le schéma du MÊME body s'il est présent : le drawer envoie
    // les champs et le modèle ensemble, et c'est le nouveau schéma qui fait foi.
    const effectiveSchema =
      body.fieldSchema !== undefined
        ? normalizeCustomFields(body.fieldSchema)
        : normalizeCustomFields(existing.fieldSchema);
    const unknown = findUnknownTemplateKeys(raw, effectiveSchema);
    if (unknown.length > 0) {
      return NextResponse.json(
        {
          error: `Modèle de libellé : ${unknown.length === 1 ? "champ inconnu" : "champs inconnus"} ${unknown
            .map((k) => `« ${k} »`)
            .join(", ")}`,
        },
        { status: 400 },
      );
    }
    // Ne rien écrire quand seul le schéma a changé : `raw` vient alors de la
    // base, le réécrire serait un no-op trompeur dans le diff.
    if (body.labelTemplate !== undefined) data.labelTemplate = raw || null;
  }
  if (body.needsAdminValidation !== undefined) {
    data.needsAdminValidation = body.needsAdminValidation === true;
  }
  if (body.needsClientValidation !== undefined) {
    data.needsClientValidation = body.needsClientValidation === true;
  }
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
    const effectiveHasAssignees = nextHasAssignees ?? existing.hasAssignees;
    if (!effectiveHasAssignees) {
      return NextResponse.json(
        { error: "Un type « équipe » doit avoir la capacité « assignés » activée" },
        { status: 400 },
      );
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
    select: {
      id: true,
      _count: { select: { entities: true, orderTemplateItems: true } },
    },
  });
  if (!existing) return NextResponse.json({ error: "Type de fiche introuvable" }, { status: 404 });

  if (existing._count.entities > 0) {
    return NextResponse.json(
      { error: "Ce type a des fiches existantes : supprimez-les (ou changez leur type) avant" },
      { status: 409 },
    );
  }
  if (existing._count.orderTemplateItems > 0) {
    return NextResponse.json(
      { error: "Ce type est utilisé par un modèle de commande — retirez-le du modèle avant" },
      { status: 409 },
    );
  }

  await prisma.entityType.delete({ where: { id } });
  return NextResponse.json({ deleted: true, id });
}
