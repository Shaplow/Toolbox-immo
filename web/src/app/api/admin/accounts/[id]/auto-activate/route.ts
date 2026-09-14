/**
 * GET  /api/admin/accounts/[id]/auto-activate — recettes attendues pour le
 *      client de ce compte et qui n'y sont pas activées.
 * POST /api/admin/accounts/[id]/auto-activate — les active (ADMIN).
 *
 * C'est le rattrapage : les comptes créés avant qu'une recette ne soit
 * allowlistée ne sont JAMAIS corrigés d'office. Ils sont signalés sur la fiche
 * compte, et l'admin clique. Rien ne bouge sans son geste.
 *
 * Body optionnel : `{ patternTemplateIds: string[] }` pour n'en activer
 * qu'une partie. Sans lui, toutes les manquantes.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import {
  applyAutoActivations,
  listMissingAutoActivations,
} from "@/lib/services/pattern/autoActivateForAccount";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const { id } = await params;

  try {
    return NextResponse.json({ missing: await listMissingAutoActivations(id) });
  } catch (err) {
    return mapServiceError(err);
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as { patternTemplateIds?: unknown };
  const only = Array.isArray(body.patternTemplateIds)
    ? body.patternTemplateIds.filter((v): v is string => typeof v === "string")
    : undefined;

  try {
    // Résultats partiels : une recette archivée entre-temps ne doit pas
    // empêcher les autres de s'activer.
    return NextResponse.json(await applyAutoActivations(id, auth.ctx, only));
  } catch (err) {
    return mapServiceError(err);
  }
}
