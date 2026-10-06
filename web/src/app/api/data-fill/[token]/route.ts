import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createRateLimiter, getClientIp } from "@/lib/http/rateLimit";

/**
 * Route publique de remplissage de DataLibrary (Phase 1.x Vague 3).
 *
 * Pas d'auth : accessible à toute personne en possession du token.
 * Le token est révocable depuis l'admin (DELETE /api/admin/libraries/data/[id]/public-fill-token).
 *
 * GET  : retourne le schéma de la lib (name + fieldsSchema) — pas les fiches existantes.
 * POST : crée des fiches dans la campagne active de la lib.
 *
 * Politique : push direct sans approval manuelle pour V1. Si la fiche est invalide,
 * l'admin peut la supprimer depuis son écran habituel. Trade-off accepté : simplicité.
 */

type FieldDef = { key: string; label: string; type: string; required?: boolean };

type Params = { params: Promise<{ token: string }> };

/**
 * Cap de longueur par valeur de champ — aligné sur la limite CSV import
 * (sanitizeValue 2000 chars) pour éviter qu'un attaquant n'injecte des MB de
 * texte dans DataEntry.fields.
 */
const MAX_FIELD_VALUE_LENGTH = 2000;

/**
 * Rate limit best-effort par IP : 10 requêtes par fenêtre glissante de 60 s.
 * In-memory uniquement → reset à chaque redéploiement, comme la magic-link.
 * Suffit à freiner un script automatisé sans nécessiter Redis (acceptable
 * vu la criticité moyenne de l'endpoint).
 *
 * Helper partagé plutôt qu'une Map locale : la route est publique (la clé IP est
 * insérée AVANT toute vérification de jeton), il faut donc une table purgée et
 * plafonnée, sinon un balayage d'IP la fait grossir sans fin.
 */
const rateLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });

async function loadLibraryByToken(token: string) {
  if (!token || token.length < 16) return null;
  return prisma.dataLibrary.findUnique({
    where: { publicFillToken: token },
    select: {
      id: true,
      name: true,
      templateType: true,
      fieldsSchema: true,
    },
  });
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { token } = await params;
  const lib = await loadLibraryByToken(token);
  if (!lib) {
    return NextResponse.json({ error: "Lien invalide ou révoqué" }, { status: 404 });
  }
  return NextResponse.json({
    libraryName: lib.name,
    templateType: lib.templateType,
    fieldsSchema: lib.fieldsSchema,
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  // Rate limit avant toute lecture DB pour ne pas amplifier l'attaque.
  const ip = getClientIp(req);
  if (!rateLimiter.check(ip)) {
    return NextResponse.json(
      { error: "Trop de requêtes, réessayez dans une minute" },
      { status: 429 },
    );
  }

  const { token } = await params;
  const lib = await loadLibraryByToken(token);
  if (!lib) {
    return NextResponse.json({ error: "Lien invalide ou révoqué" }, { status: 404 });
  }
  type EntryPayload = { setTag?: string | null; category?: string | null; fields: Record<string, string> };
  const body = (await req.json()) as { entries?: EntryPayload[] };
  if (!Array.isArray(body.entries) || body.entries.length === 0) {
    return NextResponse.json({ error: "Aucune fiche à soumettre" }, { status: 400 });
  }
  if (body.entries.length > 200) {
    return NextResponse.json({ error: "Trop de fiches en une soumission (max 200)" }, { status: 400 });
  }

  // Cap de longueur par valeur de champ — protège contre l'inflation DB via
  // payloads géants. Refuse plutôt que tronquer pour ne pas masquer l'abus.
  for (const [idx, e] of body.entries.entries()) {
    if (!e || typeof e !== "object" || !e.fields || typeof e.fields !== "object") continue;
    for (const [key, value] of Object.entries(e.fields)) {
      if (typeof value === "string" && value.length > MAX_FIELD_VALUE_LENGTH) {
        return NextResponse.json(
          {
            error: `Fiche #${idx + 1} : valeur « ${key} » dépasse la longueur maximale (${MAX_FIELD_VALUE_LENGTH} caractères)`,
          },
          { status: 400 },
        );
      }
    }
  }

  // Validation : chaque entry doit avoir au moins un champ requis renseigné (selon schéma).
  let schemaFields: FieldDef[] = [];
  try {
    const parsed = JSON.parse(lib.fieldsSchema);
    if (Array.isArray(parsed)) schemaFields = parsed as FieldDef[];
  } catch {
    // pas de schéma → tout est accepté tel quel
  }

  for (const [idx, e] of body.entries.entries()) {
    if (!e || typeof e !== "object" || !e.fields || typeof e.fields !== "object") {
      return NextResponse.json({ error: `Fiche #${idx + 1} : format invalide` }, { status: 400 });
    }
    for (const f of schemaFields) {
      if (f.required && !String(e.fields[f.key] ?? "").trim()) {
        return NextResponse.json({ error: `Fiche #${idx + 1} : « ${f.label} » est requis` }, { status: 400 });
      }
    }
  }

  try {
    const created = await prisma.dataEntry.createMany({
      data: body.entries.map((e) => ({
        libraryId: lib.id,
        setTag: e.setTag?.trim() || null,
        fields: JSON.stringify(e.fields),
      })),
    });
    return NextResponse.json({ ok: true, created: created.count }, { status: 201 });
  } catch (err) {
    console.error(`[data-fill/${token}] POST error:`, err);
    return NextResponse.json({ error: "Erreur serveur lors de la création" }, { status: 500 });
  }
}
