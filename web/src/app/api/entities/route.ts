/**
 * GET  /api/entities — liste des fiches (scopée par rôle, query typeId?/includeArchived?).
 * POST /api/entities — création d'une fiche (ADMIN réel uniquement).
 *
 * Auth : getUserContext(). Le scoping/gating vit dans entityService/entityScope.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import {
  createEntity,
  listEntities,
  type CreateEntityInput,
} from "@/lib/services/entity/entityService";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";

export async function GET(req: NextRequest) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  try {
    const entities = await listEntities(
      {
        typeId: searchParams.get("typeId"),
        includeArchived: searchParams.get("includeArchived") === "true",
      },
      userContext,
    );
    return NextResponse.json({ entities });
  } catch (err) {
    return mapServiceError(err);
  }
}

export async function POST(req: NextRequest) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

  const input: CreateEntityInput = {
    typeId: typeof body.typeId === "string" ? body.typeId : "",
    label: typeof body.label === "string" ? body.label : "",
    fields:
      body.fields !== undefined && typeof body.fields === "object" && body.fields !== null
        ? (body.fields as Record<string, string>)
        : undefined,
    accountId: str(body.accountId),
    scheduledAt: str(body.scheduledAt),
    endAt: str(body.endAt),
    assigneeVideasteId: str(body.assigneeVideasteId),
    defaultAssigneeMonteurId: str(body.defaultAssigneeMonteurId),
    defaultAssigneeCmId: str(body.defaultAssigneeCmId),
    notes: str(body.notes),
    brief: str(body.brief),
    relatedEntityId: str(body.relatedEntityId),
  };

  try {
    const entity = await createEntity(input, userContext);
    return NextResponse.json(entity, { status: 201 });
  } catch (err) {
    return mapServiceError(err);
  }
}
