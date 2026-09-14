/**
 * GET /api/entity-types/[id]/required-impact?keys=a,b — combien de fiches
 * existantes ne renseignent pas ces champs (ADMIN).
 *
 * Raison d'être : depuis que `required` bloque à CHAQUE enregistrement, cocher
 * la case dans l'admin peut rendre insauvables des dizaines de fiches déjà en
 * base. L'admin doit voir ce chiffre AVANT de cocher, pas le découvrir par un
 * message d'erreur une semaine plus tard sur une fiche qu'il essaie d'éditer.
 *
 * POST /api/entity-types/[id]/backfill-field est la sortie : remplir d'un coup
 * les fiches que ce compteur remonte.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import { normalizeCustomFields, isFieldFilled } from "@/lib/customFields";
import { safeJSON } from "@/lib/utils/json";

/**
 * Au-delà, on rend « 5000+ » plutôt que de charger toute la table : le compte
 * exact n'apporte rien à la décision, seul l'ordre de grandeur compte.
 */
const SCAN_LIMIT = 5000;

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const { id } = await params;

  const keys = (new URL(req.url).searchParams.get("keys") ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  if (keys.length === 0) return NextResponse.json({ impacts: [], scanned: 0, truncated: false });

  const type = await prisma.entityType.findUnique({
    where: { id },
    select: { fieldSchema: true },
  });
  if (!type) return NextResponse.json({ error: "Type de fiche introuvable" }, { status: 404 });

  const schema = normalizeCustomFields(type.fieldSchema);
  const targets = schema.filter((f) => keys.includes(f.key));
  if (targets.length === 0) {
    return NextResponse.json({ impacts: [], scanned: 0, truncated: false });
  }

  // `Entity.fields` est une colonne String, pas Json : aucun opérateur JSON
  // Postgres n'est utilisable, et un LIKE '%"key":"%' se ferait piéger par les
  // échappements. On charge et on compte en JS — exact, et borné par SCAN_LIMIT.
  //
  // Les fiches archivées sont exclues : elles sont exemptées du blocage
  // (cf. patchEntity), les compter gonflerait l'alerte sans raison.
  const rows = await prisma.entity.findMany({
    where: { typeId: id, isArchived: false },
    select: { fields: true },
    take: SCAN_LIMIT + 1,
  });
  const truncated = rows.length > SCAN_LIMIT;
  const scanned = truncated ? SCAN_LIMIT : rows.length;

  const counts = new Map<string, number>(targets.map((f) => [f.key, 0]));
  for (const row of rows.slice(0, SCAN_LIMIT)) {
    const values = safeJSON<Record<string, string>>(row.fields, {});
    for (const field of targets) {
      const raw = values[field.key];
      const value = typeof raw === "string" ? raw.trim() : "";
      if (!isFieldFilled(field, value)) {
        counts.set(field.key, (counts.get(field.key) ?? 0) + 1);
      }
    }
  }

  return NextResponse.json({
    impacts: targets.map((f) => ({
      key: f.key,
      label: f.label || f.key,
      type: f.type,
      missing: counts.get(f.key) ?? 0,
    })),
    scanned,
    truncated,
  });
}
