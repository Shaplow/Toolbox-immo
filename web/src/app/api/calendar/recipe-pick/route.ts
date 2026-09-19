/**
 * GET /api/calendar/recipe-pick — quelle recette proposer à ce compte, ce
 * jour-là, famille par famille. ADMIN.
 *
 * Consommé par la modale de création de publication : l'admin choisit une
 * FAMILLE (« RAUTO ») et le tourniquet choisit le membre, au lieu de lui faire
 * trancher entre huit recettes interchangeables.
 *
 * Tout est renvoyé en UN aller-retour, au changement de compte ou de date :
 * l'historique (±120 jours de publications) est chargé une fois et sert à tous
 * les classements. Un appel par clic de famille le rechargerait à chaque fois.
 *
 * Cette route PROPOSE, là où les lectures de calendrier se contentent de rendre
 * des données — cf. le doc-header de `recipePickService` pour pourquoi.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";
import { buildRecipePick } from "@/lib/services/calendar/recipePickService";

/**
 * Le jour civil doit être validé ICI, pas plus bas.
 *
 * `parisDayKey` renvoie la CHAÎNE VIDE sur une date illisible — pas null, pas
 * d'exception — et `dayIndexFromKey("")` produit un NaN qui se propage dans
 * tous les écarts sans rien déclencher : le classement sort, il est juste faux.
 */
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  const { searchParams } = new URL(req.url);
  const accountId = (searchParams.get("accountId") ?? "").trim();
  const date = (searchParams.get("date") ?? "").trim();

  if (!accountId) {
    return NextResponse.json({ error: "accountId requis" }, { status: 400 });
  }
  if (!DAY_KEY.test(date)) {
    return NextResponse.json(
      { error: "date requise au format AAAA-MM-JJ" },
      { status: 400 },
    );
  }
  if (isNaN(new Date(`${date}T12:00:00.000Z`).getTime())) {
    return NextResponse.json({ error: "date invalide" }, { status: 400 });
  }

  try {
    return NextResponse.json(await buildRecipePick({ accountId, dayKey: date }));
  } catch (err) {
    return mapServiceError(err);
  }
}
