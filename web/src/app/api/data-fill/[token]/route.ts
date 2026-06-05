import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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
 * Rate limit best-effort par IP : N requêtes par fenêtre de M secondes.
 * In-memory uniquement → reset à chaque redéploiement, comme la magic-link.
 * Suffit à freiner un script automatisé sans nécessiter Redis (acceptable
 * vu la criticité moyenne de l'endpoint).
 */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const rateLimits = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(ip);
  if (!entry || entry.resetAt < now) {
    rateLimits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) return false;
  entry.count++;
  return true;
}

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xr = req.headers.get("x-real-ip");
  if (xr) return xr;
  return "unknown";
}

async function loadLibraryByToken(token: string) {
  if (!token || token.length < 16) return null;
  return prisma.dataLibrary.findUnique({
    where: { publicFillToken: token },
    select: {
      id: true,
      name: true,
      templateType: true,
      fieldsSchema: true,
      campaigns: {
        where: { isActive: true },
        select: { id: true },
        take: 1,
      },
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
  if (!checkRateLimit(ip)) {
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
  const campaignId = lib.campaigns[0]?.id;
  if (!campaignId) {
    return NextResponse.json({ error: "Bibliothèque mal configurée (pas de campagne active)" }, { status: 500 });
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
        campaignId,
        setTag: e.setTag?.trim() || null,
        category: e.category?.trim() || null,
        fields: JSON.stringify(e.fields),
      })),
    });
    return NextResponse.json({ ok: true, created: created.count }, { status: 201 });
  } catch (err) {
    console.error(`[data-fill/${token}] POST error:`, err);
    return NextResponse.json({ error: "Erreur serveur lors de la création" }, { status: 500 });
  }
}
