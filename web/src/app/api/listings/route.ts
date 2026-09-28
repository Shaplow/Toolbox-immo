import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import { createListingForRender } from "@/lib/services/render/renderLaunchService";
import { ServiceError } from "@/lib/services/_runtime/errors";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";

// POST /api/listings
//
// Wrapper mince (plan « Lancer les rendus », étape 1) : la logique vit dans
// `renderLaunchService.createListingForRender`. Contrat HTTP identique à la
// route inline historique — `ListingForm` ne lit que `listing.id` /
// `listing.missing` / `listing.error`.
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  try {
    const body = await req.json();
    const { templateId, data } = body ?? {};
    if (!templateId) {
      return NextResponse.json({ error: "templateId requis" }, { status: 400 });
    }
    const listing = await createListingForRender(
      { templateId, data: data as Record<string, unknown> },
      auth.ctx,
    );
    return NextResponse.json(listing, { status: 201 });
  } catch (err) {
    if (err instanceof ServiceError) return mapServiceError(err);
    console.error("[POST /api/listings]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur serveur" },
      { status: 500 },
    );
  }
}

// GET /api/listings — liste les listings de l'utilisateur
export async function GET(_req: NextRequest) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;

  const listings = await prisma.listing.findMany({
    where: { userId: userContext.effectiveUser.id },
    orderBy: { createdAt: "desc" },
    include: { template: { select: { name: true, client: true } } },
  });

  return NextResponse.json(
    listings.map((l) => ({
      ...l,
      jsonData: JSON.parse(l.jsonData),
    }))
  );
}
