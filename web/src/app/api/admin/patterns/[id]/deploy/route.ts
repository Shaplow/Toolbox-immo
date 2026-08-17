/**
 * POST /api/admin/patterns/[id]/deploy
 *
 * Sprint C — Déploie une recette PatternTemplate sur N comptes en une
 * opération (crée N PatternBindings).
 * Body : { accountIds, publishTime, dayOfWeek, defaultAssignees }
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { deployTemplateToAccounts } from "@/lib/services/pattern/deployTemplate";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const ctx = auth.ctx;
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
