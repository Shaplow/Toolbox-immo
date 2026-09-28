import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { createAndStartRender } from "@/lib/services/render/renderLaunchService";
import { ServiceError } from "@/lib/services/_runtime/errors";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";
import type { RenderRequestBody } from "@/lib/generate/buildRenderRequestBody";

// POST /api/renders — déclenche une génération.
//
// Wrapper mince (plan « Lancer les rendus », étape 1) : toute la logique vit
// dans `renderLaunchService.createAndStartRender`. Le contrat HTTP reste
// identique à l'ancienne route inline — `ListingForm` ne lit que
// `render.id`/`render.error`, jamais `code` (ajouté par `mapServiceError`).
//
// Le catch-all non-ServiceError préserve le comportement historique
// (`err.message` au lieu du générique "Erreur serveur" de mapServiceError) —
// c'est le cas du kickoff "missing" (render introuvable après création), qui
// reste un message spécifique plutôt qu'une ServiceError structurée.
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  try {
    const body = (await req.json()) as RenderRequestBody;
    const render = await createAndStartRender(body, auth.ctx);
    return NextResponse.json(render, { status: 201 });
  } catch (err) {
    if (err instanceof ServiceError) return mapServiceError(err);
    console.error("[POST /api/renders]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur serveur" },
      { status: 500 },
    );
  }
}
