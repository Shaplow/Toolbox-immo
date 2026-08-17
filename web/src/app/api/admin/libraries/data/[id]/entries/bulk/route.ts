import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import {
  isBulkParseError,
  parseBulkAccessBody,
} from "@/lib/admin/libraryBulkHelpers";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/admin/libraries/data/[id]/entries/bulk
// Deux modes (exclusifs) :
//  - Dossier : { entryIds: string[], setTag?: string|null } → updateMany du Dossier (vide → null).
//  - Accès   : { entryIds: string[], accessAction: "add" | "remove_all", accountId?, accountIds? }
//
// `category` n'est plus accepté en mode bulk (concept retiré, plan simplification Phase 4).
export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  const { id: libraryId } = await params;

  const body = (await req.json()) as Record<string, unknown>;

  // ── Mode "Dossier" : bulk setTag (distinct du mode accès) ──────────────────
  if ("setTag" in body) {
    const entryIds = Array.isArray(body.entryIds)
      ? (body.entryIds.filter((x) => typeof x === "string") as string[])
      : [];
    if (entryIds.length === 0) {
      return NextResponse.json({ error: "entryIds requis" }, { status: 400 });
    }
    const v = body.setTag;
    if (v !== null && typeof v !== "string") {
      return NextResponse.json({ error: "setTag invalide" }, { status: 400 });
    }
    const trimmed = typeof v === "string" ? v.trim() : "";
    const data = { setTag: trimmed === "" ? null : trimmed };

    try {
      const count = await prisma.dataEntry.count({
        where: { id: { in: entryIds }, libraryId },
      });
      if (count !== entryIds.length) {
        return NextResponse.json(
          { error: "Certaines entrées n'appartiennent pas à cette bibliothèque" },
          { status: 400 },
        );
      }
      const result = await prisma.dataEntry.updateMany({
        where: { id: { in: entryIds }, libraryId },
        data,
      });
      return NextResponse.json({ updated: result.count });
    } catch (err) {
      console.error(
        `[admin/libraries/data/${libraryId}/entries/bulk] PATCH setTag error:`,
        err,
      );
      return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
    }
  }

  const parsed = parseBulkAccessBody(body, "entryIds", { requireAction: true });
  if (isBulkParseError(parsed)) {
    return NextResponse.json({ error: parsed.message }, { status: parsed.status });
  }
  const { ids: entryIds, action: accessAction, accountIds: accessAccountIds } = parsed;

  try {
    const count = await prisma.dataEntry.count({
      where: { id: { in: entryIds }, libraryId },
    });
    if (count !== entryIds.length) {
      return NextResponse.json(
        { error: "Certaines entrées n'appartiennent pas à cette bibliothèque" },
        { status: 400 },
      );
    }

    let updated = 0;

    await prisma.$transaction(async (tx) => {
      if (accessAction === "add") {
        const rows = entryIds.flatMap((entryId) =>
          accessAccountIds.map((accountId) => ({ entryId, accountId })),
        );
        const result = await tx.dataEntryAccess.createMany({
          data: rows,
          skipDuplicates: true,
        });
        updated = result.count;
      } else {
        const result = await tx.dataEntryAccess.deleteMany({
          where: {
            entryId: { in: entryIds },
            ...(accessAccountIds.length > 0 ? { accountId: { in: accessAccountIds } } : {}),
          },
        });
        updated = result.count;
      }
    });

    return NextResponse.json({ updated });
  } catch (err) {
    console.error(`[admin/libraries/data/${libraryId}/entries/bulk] PATCH error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
