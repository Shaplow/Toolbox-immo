/**
 * POST /api/admin/patterns/[id]/deploy
 *
 * Sprint C — Déploie une recette PatternTemplate sur N comptes en une
 * opération (crée N PatternBindings).
 * Body : { accountIds, publishTime, dayOfWeek, defaultAssignees }
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { deployTemplateToAccounts } from "@/lib/services/pattern/deployTemplate";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  const ctx = await getUserContext();
  if (!ctx?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const { id } = await params;

  let body: {
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
    const result = await deployTemplateToAccounts(
      {
        patternTemplateId: id,
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
