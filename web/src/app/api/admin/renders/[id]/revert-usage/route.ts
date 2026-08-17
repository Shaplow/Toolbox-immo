import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import { revertRenderUsage } from "@/lib/recordLibraryUsage";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/renders/:id/revert-usage
 *
 * Admin-only. Rolls back the library consumption of a DONE render:
 * - Decrements usageCount on every MediaAsset / DataEntry used
 * - Clears lastUsedAt when the count reaches zero
 * - Attempts a conditional AccountLibraryCursor revert using the prefill snapshot
 *
 * Returns a RevertSummary describing what was reverted and any warnings.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;

  const { id } = await params;

  const render = await prisma.render.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!render) {
    return NextResponse.json({ error: "Render introuvable" }, { status: 404 });
  }
  if (render.status !== "DONE") {
    return NextResponse.json(
      { error: `Ce render n'est pas DONE (status=${render.status}). Seuls les renders terminés peuvent être revertés.` },
      { status: 422 },
    );
  }

  try {
    const summary = await revertRenderUsage(id);
    console.info(
      `[admin/revert-usage] admin=${userContext.actualUser.id} reverted render=${id} assets=${summary.assets.length} cursors=${summary.cursors.length} warnings=${summary.warnings.length}`,
    );
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[admin/revert-usage] render=${id} failed:`, err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
