/**
 * POST /api/entity-types/[id]/backfill-field — remplit un champ sur toutes les
 * fiches d'un type où il est encore vide (ADMIN).
 *
 * C'est la contrepartie de required-impact : rendre un champ obligatoire n'a de
 * sens que si l'on peut vider, dans la foulée, la population qui ne le
 * respecte pas. Sans ça, cocher « requis » laisserait derrière soi des fiches
 * définitivement bloquées à l'édition.
 *
 * N'écrase JAMAIS une valeur existante : seules les fiches où le champ est vide
 * (ou décoché, pour une case) sont touchées.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import {
  CHECKBOX_TRUE,
  normalizeCustomFields,
  isFieldFilled,
  validateFieldValues,
} from "@/lib/customFields";
import { safeJSON } from "@/lib/utils/json";

/** Même borne que le compteur d'impact : au-delà, c'est un script, pas un clic. */
const MAX_BACKFILL = 5000;

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as { key?: unknown; value?: unknown };
  const key = typeof body.key === "string" ? body.key.trim() : "";
  const value = typeof body.value === "string" ? body.value.trim() : "";
  if (!key) return NextResponse.json({ error: "Clé de champ requise" }, { status: 400 });

  const type = await prisma.entityType.findUnique({
    where: { id },
    select: { fieldSchema: true },
  });
  if (!type) return NextResponse.json({ error: "Type de fiche introuvable" }, { status: 404 });

  const schema = normalizeCustomFields(type.fieldSchema);
  const field = schema.find((f) => f.key === key);
  if (!field) {
    return NextResponse.json({ error: `Champ « ${key} » inconnu sur ce type` }, { status: 400 });
  }

  // Une valeur de remplissage qui ne passerait pas la validation laisserait les
  // fiches tout aussi bloquées — avec en prime une donnée fausse partout.
  const normalized = field.type === "checkbox" && value ? CHECKBOX_TRUE : value;
  if (!isFieldFilled(field, normalized)) {
    return NextResponse.json(
      {
        error:
          field.type === "checkbox"
            ? "Une case ne peut être remplie qu'en étant cochée"
            : "Une valeur non vide est requise",
      },
      { status: 400 },
    );
  }
  const invalid = validateFieldValues([field], { [key]: normalized }, { allowUnknownKeys: true });
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  const rows = await prisma.entity.findMany({
    where: { typeId: id, isArchived: false },
    select: { id: true, fields: true },
    take: MAX_BACKFILL,
  });

  const toUpdate = rows.filter((row) => {
    const values = safeJSON<Record<string, string>>(row.fields, {});
    const raw = values[key];
    return !isFieldFilled(field, typeof raw === "string" ? raw.trim() : "");
  });

  // Une fiche = une écriture : `fields` est un blob JSON, il n'y a pas d'update
  // ensembliste possible sans écraser les autres clés. Borné par MAX_BACKFILL.
  let updated = 0;
  for (const row of toUpdate) {
    const values = safeJSON<Record<string, string>>(row.fields, {});
    values[key] = normalized;
    await prisma.entity.update({
      where: { id: row.id },
      data: { fields: JSON.stringify(values) },
    });
    updated++;
  }

  return NextResponse.json({ updated, scanned: rows.length });
}
