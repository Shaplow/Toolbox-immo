/**
 * POST /api/admin/patterns/deploy
 *
 * Applique PLUSIEURS recettes à N comptes en une opération — la version
 * multi-recettes de `[id]/deploy` (qui reste le chemin une-recette).
 * Body : { patternTemplateIds, accountIds, publishTime, dayOfWeek, defaultAssignees }
 *
 * Réponse à résultats partiels : { ok, failed, createdCount, skippedCount }.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { deployTemplatesToAccounts } from "@/lib/services/pattern/deployTemplate";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const ctx = auth.ctx;

  let body: {
    patternTemplateIds?: string[];
    accountIds?: string[];
    publishTime?: string;
    dayOfWeek?: number[];
    defaultAssigneeMonteurId?: string | null;
    defaultAssigneeCmId?: string | null;
    defaultAssigneeVideasteId?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  try {
    const result = await deployTemplatesToAccounts(
      {
        patternTemplateIds: body.patternTemplateIds ?? [],
        accountIds: body.accountIds ?? [],
        publishTime: body.publishTime ?? "",
        dayOfWeek: body.dayOfWeek ?? [],
        defaultAssigneeMonteurId: body.defaultAssigneeMonteurId ?? null,
        defaultAssigneeCmId: body.defaultAssigneeCmId ?? null,
        defaultAssigneeVideasteId: body.defaultAssigneeVideasteId ?? null,
      },
      ctx,
    );
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return mapServiceError(err);
  }
}
