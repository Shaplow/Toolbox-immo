/**
 * POST /api/admin/renders/:id/force-fail
 *
 * Admin-only. Force un render bloqué (PENDING/PROCESSING/QUEUED) en ERROR.
 * Déclenche revertLibraryCursors pour libérer la rotation.
 *
 * Cas d'usage : un render reste PROCESSING sans heartbeat depuis trop
 * longtemps (RunPod crash, webhook perdu, machine éteinte). Permettre à
 * l'admin de débloquer manuellement le slot pour relancer.
 *
 * Sécurité : refuse de force-fail un render déjà DONE (utiliser revert-usage
 * à la place — ce n'est pas un échec).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import { revertLibraryCursors } from "@/lib/recordLibraryUsage";
import { logActivity } from "@/lib/services/slot/activity";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;

  const { id } = await params;

  const render = await prisma.render.findUnique({
    where: { id },
    select: { id: true, status: true, publicationSlotId: true, lastHeartbeatAt: true },
  });
  if (!render) {
    return NextResponse.json({ error: "Render introuvable" }, { status: 404 });
  }
  if (render.status === "DONE") {
    return NextResponse.json(
      { error: "Ce render est DONE — utiliser /revert-usage pour réinitialiser la rotation" },
      { status: 422 },
    );
  }
  if (render.status === "ERROR") {
    return NextResponse.json(
      { error: "Ce render est déjà ERROR — re-revert au besoin via /revert-usage" },
      { status: 422 },
    );
  }

  const message = `Force-failed by admin (${userContext.actualUser.id}). Last heartbeat: ${render.lastHeartbeatAt?.toISOString() ?? "never"}.`;

  await prisma.render.update({
    where: { id },
    data: {
      status: "ERROR",
      errorMsg: message,
      finishedAt: new Date(),
      progress: 1,
      statusDetail: "force-failed-by-admin",
    },
  });

  // Revert library cursors (best-effort)
  await revertLibraryCursors(id).catch((err) => {
    console.error(`[force-fail] revertLibraryCursors error for render=${id}:`, err);
  });

  // Log l'activité si le render est rattaché à un slot
  if (render.publicationSlotId) {
    await logActivity(prisma, {
      slotId: render.publicationSlotId,
      actorId: userContext.actualUser.id,
      type: "STATUS_CHANGED",
      payload: { renderId: id, from: render.status, to: "ERROR", trigger: "force-fail" },
    });
  }

  console.info(`[admin/force-fail] admin=${userContext.actualUser.id} render=${id} forced from ${render.status} to ERROR`);

  return NextResponse.json({ ok: true });
}
