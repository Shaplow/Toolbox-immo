/**
 * GET /api/entity-types/[id]/field-keys — clés du fieldSchema de CE type de
 * fiche (remplace `properties/field-keys`, qui agrégeait sur tous les biens :
 * désormais le schéma vit directement sur le type, une seule fiche à lire).
 *
 * Alimente le sélecteur « Champ de la fiche qui pré-remplit la légende » du
 * form recette (mode description "preFilled").
 *
 * Admin-only. Auth via getUserContext() / canAdminBypass.
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import { normalizeCustomFields } from "@/lib/customFields";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const { id } = await params;

  const type = await prisma.entityType.findUnique({
    where: { id },
    select: { fieldSchema: true },
  });
  if (!type) return NextResponse.json({ error: "Type de fiche introuvable" }, { status: 404 });

  const keys = normalizeCustomFields(type.fieldSchema).map((f) => ({
    key: f.key,
    label: f.label || f.key,
  }));

  return NextResponse.json(keys);
}
