/**
 * POST /api/entities/bulk — actions groupées sur des fiches (ADMIN).
 *
 * Body : { ids: string[], action: "archive" | "unarchive" | "delete" | "reassign",
 *          assignees?: { assigneeVideasteId?, defaultAssigneeMonteurId?, defaultAssigneeCmId? } }
 *
 * Réponse : { ok: string[], failed: { id, label, error }[] } — résultats
 * PARTIELS, comme bulkPatchSlots. L'UI DOIT afficher `failed` : c'est là que
 * l'admin apprend que 3 fiches sur 40 portent encore des publications.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import { bulkPatchEntities, type BulkEntityAction } from "@/lib/services/entity/entityService";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";

const ACTIONS: BulkEntityAction[] = ["archive", "unarchive", "delete", "reassign"];

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  const body = (await req.json().catch(() => ({}))) as {
    ids?: unknown;
    action?: unknown;
    assignees?: unknown;
  };

  if (!Array.isArray(body.ids)) {
    return NextResponse.json({ error: "ids requis" }, { status: 400 });
  }
  if (typeof body.action !== "string" || !ACTIONS.includes(body.action as BulkEntityAction)) {
    return NextResponse.json({ error: "Action inconnue" }, { status: 400 });
  }

  try {
    const result = await bulkPatchEntities(
      {
        ids: body.ids as string[],
        action: body.action as BulkEntityAction,
        assignees: (body.assignees ?? undefined) as
          | {
              assigneeVideasteId?: string | null;
              defaultAssigneeMonteurId?: string | null;
              defaultAssigneeCmId?: string | null;
            }
          | undefined,
      },
      auth.ctx,
    );
    return NextResponse.json(result);
  } catch (err) {
    return mapServiceError(err);
  }
}
