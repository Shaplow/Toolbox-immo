/**
 * POST /api/properties/[id]/missions — lance N missions d'un bien en une fois.
 *
 * Body : { recipeIds: string[], accountId?: string | null }.
 * Crée une mission (PublicationSlot) par recette, toutes référençant ce bien
 * (propertyId). Réutilise createSlot (résolution binding compte×recette,
 * héritage assignés, etc.).
 *
 * Auth : outil `mission` (hasTool) OU admin réel (canAdminBypass) — cohérent
 * avec POST /api/missions.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { hasTool, TOOLS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { createSlot } from "@/lib/services/slot/slotService";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { id: propertyId } = await params;

  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const authorized =
    userContext.canAdminBypass ||
    (await hasTool(userContext.effectiveUser.id, TOOLS.MISSION));
  if (!authorized) {
    return NextResponse.json(
      { error: "Vous n'avez pas accès à l'outil Missions" },
      { status: 403 },
    );
  }

  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { id: true, isArchived: true },
  });
  if (!property || property.isArchived) {
    return NextResponse.json({ error: "Bien introuvable" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const recipeIds = Array.isArray(body.recipeIds)
    ? body.recipeIds.filter((r): r is string => typeof r === "string" && !!r)
    : [];
  if (recipeIds.length === 0) {
    return NextResponse.json(
      { error: "Sélectionnez au moins une recette" },
      { status: 400 },
    );
  }
  const accountId =
    typeof body.accountId === "string" && body.accountId ? body.accountId : null;

  try {
    const createdIds: string[] = [];
    for (const recipeId of recipeIds) {
      const slot = await createSlot(
        { patternTemplateId: recipeId, accountId, propertyId },
        userContext,
        { requireAdmin: false },
      );
      createdIds.push(slot.id);
    }
    return NextResponse.json({ createdIds, count: createdIds.length });
  } catch (err) {
    return mapServiceError(err);
  }
}
