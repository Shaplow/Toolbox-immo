import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasTool, TOOLS } from "@/lib/permissions";

// POST /api/renders — déclenche une génération
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const isAdmin = session.user.role === "ADMIN";

  // Verify the user has the templates tool
  if (!isAdmin && !(await hasTool(session.user.id, TOOLS.TEMPLATES))) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const body = await req.json();
  const { templateId, listingId } = body;

  if (!templateId || !listingId) {
    return NextResponse.json(
      { error: "templateId et listingId requis" },
      { status: 400 }
    );
  }

  // Verify the user has access to this specific template
  if (!isAdmin) {
    const access = await prisma.templateAccess.findUnique({
      where: { userId_templateId: { userId: session.user.id, templateId } },
    });
    if (!access) {
      return NextResponse.json({ error: "Accès au template refusé" }, { status: 403 });
    }
  }

  // Vérifier que le listing appartient à l'utilisateur
  const listing = await prisma.listing.findFirst({
    where: { id: listingId, userId: session.user.id },
  });
  if (!listing) {
    return NextResponse.json({ error: "Listing introuvable" }, { status: 404 });
  }

  // Créer le render en PENDING
  const render = await prisma.render.create({
    data: { templateId, listingId, status: "PENDING" },
  });

  // Déclencher la génération en arrière-plan (fire & forget)
  // On ne peut pas utiliser de worker natif ici en Next.js,
  // donc on appelle la route interne de manière async sans attendre.
  // IMPORTANT: doit passer x-internal-key car le middleware bloque /api/* sans session.
  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  fetch(`${baseUrl}/api/renders/${render.id}/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-key": process.env.INTERNAL_API_KEY ?? "",
    },
  }).catch((err) => {
    console.error(`[renders] Fire-and-forget generate failed for ${render.id}:`, err);
  });

  return NextResponse.json(render, { status: 201 });
}
