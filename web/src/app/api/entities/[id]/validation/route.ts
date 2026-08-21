/**
 * POST /api/entities/[id]/validation — action de validation sur une fiche.
 * Body : { action: "approve" | "reject" | "request", comment? }.
 *
 * Mécanisme unique de la validation bidirectionnelle :
 *  - ADMIN réel : approve/reject (PENDING_ADMIN et PENDING_CLIENT), request
 *    (re-soumettre au client).
 *  - EXTERNAL : approve/reject sur une fiche PENDING_CLIENT de son périmètre.
 * Le gating fin vit dans entityService.setEntityValidation.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import {
  setEntityValidation,
  type SetEntityValidationInput,
} from "@/lib/services/entity/entityService";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const action = body.action;
  if (action !== "approve" && action !== "reject" && action !== "request") {
    return NextResponse.json(
      { error: "action doit être approve, reject ou request" },
      { status: 400 },
    );
  }

  const input: SetEntityValidationInput = {
    action,
    comment: typeof body.comment === "string" ? body.comment : null,
  };

  try {
    const entity = await setEntityValidation(id, input, auth.ctx);
    // Externe : ne jamais renvoyer les internals de la fiche (notes équipe,
    // assignés, compteurs) — l'UI ignore le body (router.refresh), id +
    // validationStatus suffisent. L'admin garde la fiche complète.
    if (!auth.ctx.canAdminBypass) {
      return NextResponse.json({ id: entity.id, validationStatus: entity.validationStatus });
    }
    return NextResponse.json(entity);
  } catch (err) {
    return mapServiceError(err);
  }
}
