import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

// Plan simplification 2026-08 : "override" (ordre fixe + curseur) est
// décommissionné — cf. src/lib/rotation/rotationMode.ts (source de vérité).
const VALID_ROTATION_MODES = ["auto", "none"] as const;
const VALID_ROTATION_SCOPES = ["shared", "per_account"] as const;
const VALID_FIELD_TYPES = ["text", "number", "url", "textarea"] as const;

type FieldDef = { key: string; label: string; type: string; required?: boolean; primary?: boolean };

function validateFieldsSchema(raw: unknown): { ok: true; json: string } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "fieldsSchema doit être un tableau" };
  const seen = new Set<string>();
  for (const f of raw as FieldDef[]) {
    if (!f || typeof f !== "object") return { ok: false, error: "Chaque champ doit être un objet" };
    if (!f.key || typeof f.key !== "string" || !/^[a-z][a-z0-9_]*$/i.test(f.key)) {
      return { ok: false, error: `Clé invalide « ${f.key} » : lettres/chiffres/underscore, commencer par une lettre` };
    }
    if (["set_tag", "category"].includes(f.key.toLowerCase())) {
      return { ok: false, error: `« set_tag » et « category » sont réservés et ajoutés automatiquement` };
    }
    if (seen.has(f.key)) return { ok: false, error: `Clé « ${f.key} » dupliquée` };
    seen.add(f.key);
    if (!f.label || typeof f.label !== "string") return { ok: false, error: `Label manquant pour « ${f.key} »` };
    if (!VALID_FIELD_TYPES.includes(f.type as typeof VALID_FIELD_TYPES[number])) {
      return { ok: false, error: `Type invalide « ${f.type} » : ${VALID_FIELD_TYPES.join(" | ")}` };
    }
    if (f.primary !== undefined && typeof f.primary !== "boolean") {
      return { ok: false, error: `« ${f.key} » : primary doit être un boolean` };
    }
  }
  return { ok: true, json: JSON.stringify(raw) };
}

// PATCH /api/admin/libraries/data/[id] — met à jour le nom, la description
// et les réglages de rotation (rotationMode, rotationScope, maxUsageCount).
export async function PATCH(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json() as {
    name?: string;
    description?: string;
    rotationMode?: string;
    rotationScope?: string;
    maxUsageCount?: number | null;
    fieldsSchema?: unknown;
  };

  const data: Record<string, string | number | null> = {};
  if (body.name?.trim()) data.name = body.name.trim();
  if (body.description !== undefined) data.description = body.description?.trim() || null;
  if (body.rotationMode !== undefined) {
    if (!VALID_ROTATION_MODES.includes(body.rotationMode as typeof VALID_ROTATION_MODES[number])) {
      return NextResponse.json({ error: `rotationMode doit être ${VALID_ROTATION_MODES.join(" | ")}` }, { status: 400 });
    }
    data.rotationMode = body.rotationMode;
  }
  if (body.rotationScope !== undefined) {
    if (!VALID_ROTATION_SCOPES.includes(body.rotationScope as typeof VALID_ROTATION_SCOPES[number])) {
      return NextResponse.json({ error: `rotationScope doit être ${VALID_ROTATION_SCOPES.join(" | ")}` }, { status: 400 });
    }
    data.rotationScope = body.rotationScope;
  }
  if (body.maxUsageCount !== undefined) {
    if (body.maxUsageCount !== null && (!Number.isInteger(body.maxUsageCount) || body.maxUsageCount < 1)) {
      return NextResponse.json({ error: "maxUsageCount doit être null ou un entier ≥ 1" }, { status: 400 });
    }
    data.maxUsageCount = body.maxUsageCount;
  }
  if (body.fieldsSchema !== undefined) {
    const result = validateFieldsSchema(body.fieldsSchema);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    data.fieldsSchema = result.json;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Aucun champ à mettre à jour" }, { status: 400 });
  }

  try {
    const updated = await prisma.dataLibrary.update({ where: { id }, data });
    return NextResponse.json(updated);
  } catch (err) {
    console.error(`[admin/libraries/data/${id}] PATCH error:`, err);
    return NextResponse.json({ error: "Erreur serveur lors de la mise à jour" }, { status: 500 });
  }
}

// DELETE /api/admin/libraries/data/[id] — supprime une DataLibrary (cascade campaigns + entries)
export async function DELETE(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;
  try {
    const library = await prisma.dataLibrary.findUnique({ where: { id } });
    if (!library) {
      return NextResponse.json({ error: "Bibliothèque introuvable" }, { status: 404 });
    }
    await prisma.dataLibrary.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[admin/libraries/data/${id}] DELETE error:`, err);
    return NextResponse.json({ error: "Erreur serveur lors de la suppression" }, { status: 500 });
  }
}
