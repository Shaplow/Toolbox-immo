/**
 * POST /api/missions — création d'une « mission ».
 *
 * Une mission = un PublicationSlot piloté par une recette GLOBALE
 * (patternTemplateId, obligatoire), avec un compte Instagram OPTIONNEL. Sans
 * compte, c'est une production « stock » archivable en médiathèque.
 *
 * Auth : outil `mission` (hasTool) OU admin réel (canAdminBypass). Contrairement
 * à POST /api/calendar/slots (admin-only), cette route est attribuable par rôle/
 * utilisateur via le système d'outils — c'est le point d'entrée d'une CM.
 *
 * Le body est volontairement restreint (pas d'override d'assignees / pattern
 * arbitraire) : la config vient de la recette. createSlot est appelé avec
 * requireAdmin=false puisque l'autorisation est faite ici via l'outil.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { hasTool, TOOLS } from "@/lib/permissions";
import { createSlot, type CreateSlotInput } from "@/lib/services/slot/slotService";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;

  // Autorisation via l'outil `mission` (ou admin réel). hasTool honore le scope
  // de rôle ET les permissions individuelles.
  const authorized =
    userContext.canAdminBypass ||
    (await hasTool(userContext.effectiveUser.id, TOOLS.MISSION));
  if (!authorized) {
    return NextResponse.json(
      { error: "Vous n'avez pas accès à l'outil Missions" },
      { status: 403 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  if (typeof body.patternTemplateId !== "string" || !body.patternTemplateId.trim()) {
    return NextResponse.json(
      { error: "Une recette (patternTemplateId) est requise pour une mission" },
      { status: 400 },
    );
  }

  // Input restreint : la recette pilote la config, on n'accepte que les champs
  // sûrs saisis par l'utilisateur (compte optionnel, bien optionnel).
  const input: CreateSlotInput = {
    patternTemplateId: body.patternTemplateId,
    accountId: typeof body.accountId === "string" && body.accountId ? body.accountId : null,
    // Biens — fiche de données partagée référencée par la mission (résolue live).
    propertyId: typeof body.propertyId === "string" && body.propertyId ? body.propertyId : null,
    title: typeof body.title === "string" ? body.title : null,
    description: typeof body.description === "string" ? body.description : null,
    notes: typeof body.notes === "string" ? body.notes : null,
    fields:
      body.fields && typeof body.fields === "object"
        ? (body.fields as Record<string, string>)
        : undefined,
  };

  try {
    const slot = await createSlot(input, userContext, { requireAdmin: false });
    return NextResponse.json(slot);
  } catch (err) {
    return mapServiceError(err);
  }
}
