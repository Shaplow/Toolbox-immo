import { NextRequest, NextResponse } from "next/server";
import { requireUser, requireAdmin } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import { RENDER_PIPELINE, RENDER_STAGE } from "@/lib/renderer/renderWorkflow";
import { revertLibraryCursors } from "@/lib/recordLibraryUsage";

type Params = { params: Promise<{ id: string }> };

// LOCAL_STALL_MS must exceed LOCAL_VIDEO_RENDER_TIMEOUT_MS (10 min in generateRender.ts)
// so the fetch timeout always fires before the stall detector, preventing a race where
// the stall marks the render ERROR while the fetch is still running or just completed.
const LOCAL_STALL_MS = 12 * 60 * 1000;
const PRE_SUBMIT_STALL_MS = 2 * 60 * 1000;

// GET /api/renders/:id — statut courant (RunPod completes via webhook, pas de polling ici)
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;
  const { id } = await params;

  let render = await prisma.render.findUnique({ where: { id } });
  if (!render) return NextResponse.json({ error: "Render introuvable" }, { status: 404 });

  // Vérifier ownership via listing (admin peut voir tous les renders)
  const isAdmin = userContext.canAdminBypass;
  if (!isAdmin) {
    const listing = await prisma.listing.findFirst({
      where: { id: render.listingId, userId: userContext.effectiveUser.id },
    });
    if (!listing) return NextResponse.json({ error: "Render introuvable" }, { status: 404 });
  }

  const now = Date.now();
  const heartbeatAge = render.lastHeartbeatAt ? now - render.lastHeartbeatAt.getTime() : null;

  // ─── Local stall (render vidéo local sans heartbeat) ────────────────────
  let stalled = false;
  if (
    render.status === "PROCESSING" &&
    render.pipeline === RENDER_PIPELINE.VIDEO_LOCAL &&
    heartbeatAge !== null &&
    heartbeatAge > LOCAL_STALL_MS
  ) {
    render = await prisma.render.update({
      where: { id },
      data: {
        status: "ERROR",
        stage: RENDER_STAGE.STALLED,
        statusDetail: "Le rendu local n'a plus donné de signe de vie",
        errorMsg: "Le rendu vidéo local semble bloqué. Vérifie les logs web et render-engine.",
        progress: 1,
        finishedAt: new Date(),
        lastHeartbeatAt: new Date(),
      },
    });
    stalled = true;
  } else if (
    // ─── Pre-submit stall (RunPod sans runpodJobId) ───────────────────────
    render.status === "PROCESSING" &&
    render.pipeline === RENDER_PIPELINE.VIDEO_RUNPOD &&
    !render.runpodJobId &&
    heartbeatAge !== null &&
    heartbeatAge > PRE_SUBMIT_STALL_MS
  ) {
    render = await prisma.render.update({
      where: { id },
      data: {
        status: "ERROR",
        stage: RENDER_STAGE.STALLED,
        statusDetail: "Le rendu est bloqué avant soumission RunPod",
        errorMsg: "Le rendu vidéo est resté bloqué avant la création du job RunPod.",
        progress: 1,
        finishedAt: new Date(),
        lastHeartbeatAt: new Date(),
      },
    });
    stalled = true;
  }

  // Bugfix asset rotation P1 : sans cet appel, le cursor avancé au moment du
  // submit (advanceLibraryCursorsOnSubmit) restait permanemment consommé pour
  // un render qui n'a jamais abouti. Conséquence silencieuse : la rotation
  // theme_sequence sautait une position à chaque stall, drift cumulatif.
  // Aligné sur failRender (generateRender.ts) et webhook ERROR (webhooks/runpod/renders).
  if (stalled) {
    revertLibraryCursors(id).catch((err) => {
      console.error(`[renders/GET stall] revertLibraryCursors failed for render=${id}:`, err);
    });
  }

  return NextResponse.json(render);
}

// DELETE /api/renders/:id — admin only
export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const deleteContext = auth.ctx;
  const { id } = await params;
  const render = await prisma.render.findUnique({ where: { id } });
  if (!render) return NextResponse.json({ error: "Render introuvable" }, { status: 404 });
  await prisma.render.delete({ where: { id } });
  // actualUser.id for audit: who actually performed the deletion
  console.warn(`[renders/DELETE] admin=${deleteContext.actualUser.id} deleted render=${id} status=${render.status}`);
  return NextResponse.json({ ok: true });
}
