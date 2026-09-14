/**
 * GET  /api/calendar/week-fill — le contexte de répartition : pool de recettes
 *      proposables par compte, et historique d'usage. ADMIN.
 * POST /api/calendar/week-fill — crée les publications d'un remplissage.
 *
 * Répond au temps perdu à « dispatcher correctement les reels entre tous les
 * comptes pour pas qu'on se retrouve avec 2× le même reel posté trop
 * rapidement » : le calcul du tourniquet vit dans `lib/calendar/dispatch`
 * (pur), la lecture et l'écriture dans `weekFillService`.
 *
 * Le GET ne renvoie que des données, jamais une proposition : l'écran calcule
 * lui-même avec le module pur, ce qui lui permet de recalculer instantanément à
 * chaque case échangée sans rappeler le serveur.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";
import {
  applyWeekFill,
  buildWeekFillContext,
  dispatchWindow,
  type WeekFillCellInput,
} from "@/lib/services/calendar/weekFillService";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  const { searchParams } = new URL(req.url);
  const accountIds = (searchParams.get("accountIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const weekStartRaw = searchParams.get("weekStart");

  if (accountIds.length === 0) {
    return NextResponse.json({ error: "accountIds requis" }, { status: 400 });
  }
  const weekStart = weekStartRaw ? new Date(weekStartRaw) : new Date();
  if (isNaN(weekStart.getTime())) {
    return NextResponse.json({ error: "weekStart invalide" }, { status: 400 });
  }

  try {
    const { windowFrom, windowTo } = dispatchWindow(weekStart);
    return NextResponse.json(
      await buildWeekFillContext({ accountIds, windowFrom, windowTo }),
    );
  } catch (err) {
    return mapServiceError(err);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  const body = (await req.json().catch(() => ({}))) as { cells?: unknown };
  if (!Array.isArray(body.cells)) {
    return NextResponse.json({ error: "cells requis" }, { status: 400 });
  }

  // Whitelist stricte : ce POST crée des publications, il ne recopie pas un
  // objet client.
  const cells: WeekFillCellInput[] = (body.cells as Record<string, unknown>[]).map((c) => ({
    accountId: typeof c?.accountId === "string" ? c.accountId : "",
    patternBindingId: typeof c?.patternBindingId === "string" ? c.patternBindingId : "",
    dayKey: typeof c?.dayKey === "string" ? c.dayKey : "",
    time: typeof c?.time === "string" ? c.time : "",
  }));
  if (cells.some((c) => !c.accountId || !c.patternBindingId || !c.dayKey || !c.time)) {
    return NextResponse.json({ error: "Case incomplète dans cells" }, { status: 400 });
  }

  try {
    // Résultats partiels : une case refusée (jour déjà occupé entre l'aperçu et
    // la confirmation) ne doit pas annuler les autres.
    return NextResponse.json(await applyWeekFill(cells, auth.ctx));
  } catch (err) {
    return mapServiceError(err);
  }
}
