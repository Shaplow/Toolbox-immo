import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getR2PublicUrl } from "@/lib/r2";
import { RENDER_PIPELINE, RENDER_STAGE } from "@/lib/renderer/renderWorkflow";
import { IMPERSONATION_COOKIE_NAME, resolveUserContext } from "@/lib/userContext";

type Params = { params: Promise<{ id: string }> };

const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID;
const LOCAL_STALL_MS = 10 * 60 * 1000;
const PRE_SUBMIT_STALL_MS = 2 * 60 * 1000;

type RunpodStatus = "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT";
interface RunpodStatusResponse {
  id: string;
  status: RunpodStatus;
  output?: { video_url?: string; output_key?: string };
  error?: string;
}

async function fetchRunpodStatus(jobId: string): Promise<RunpodStatusResponse> {
  const res = await fetch(
    `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}/status/${jobId}`,
    { headers: { Authorization: `Bearer ${RUNPOD_API_KEY}` }, cache: "no-store" }
  );
  if (!res.ok) throw new Error(`RunPod status ${res.status}`);
  return res.json();
}

// GET /api/renders/:id — statut + urls de téléchargement (+ polling RunPod pour les renders vidéo)
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const userContext = await resolveUserContext(session, _req.cookies.get(IMPERSONATION_COOKIE_NAME)?.value ?? null);
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

  // ─── Polling RunPod (renders vidéo en cours) ────────────────────────────
  if (render.runpodJobId && render.status === "PROCESSING" && RUNPOD_API_KEY && RUNPOD_ENDPOINT_ID) {
    try {
      const rp = await fetchRunpodStatus(render.runpodJobId);
      if (rp.status === "COMPLETED") {
        const videoUrl = rp.output?.video_url ?? (rp.output?.output_key ? getR2PublicUrl(rp.output.output_key) : null);
        render = await prisma.render.update({
          where: { id },
          data: {
            status: "DONE",
            stage: RENDER_STAGE.DONE,
            statusDetail: "Vidéo RunPod terminée",
            progress: 1,
            videoUrl: videoUrl ?? undefined,
            finishedAt: new Date(),
            lastHeartbeatAt: new Date(),
          },
        });
      } else if (rp.status === "IN_QUEUE") {
        render = await prisma.render.update({
          where: { id },
          data: {
            pipeline: RENDER_PIPELINE.VIDEO_RUNPOD,
            stage: RENDER_STAGE.VIDEO_RUNPOD_QUEUED,
            statusDetail: "Job en attente côté RunPod",
            progress: Math.max(render.progress ?? 0.6, 0.62),
            lastHeartbeatAt: new Date(),
          },
        });
      } else if (rp.status === "IN_PROGRESS") {
        render = await prisma.render.update({
          where: { id },
          data: {
            pipeline: RENDER_PIPELINE.VIDEO_RUNPOD,
            stage: RENDER_STAGE.VIDEO_RUNPOD_PROCESSING,
            statusDetail: "RunPod encode la vidéo",
            progress: Math.max(render.progress ?? 0.7, 0.78),
            lastHeartbeatAt: new Date(),
          },
        });
      } else if (["FAILED", "CANCELLED", "TIMED_OUT"].includes(rp.status)) {
        render = await prisma.render.update({
          where: { id },
          data: {
            status: "ERROR",
            stage: RENDER_STAGE.ERROR,
            statusDetail: rp.error ?? `RunPod job ${rp.status}`,
            errorMsg: rp.error ?? `RunPod job ${rp.status}`,
            progress: 1,
            finishedAt: new Date(),
            lastHeartbeatAt: new Date(),
          },
        });
      }
      // IN_QUEUE / IN_PROGRESS → on retourne le statut courant
    } catch (e) {
      console.error("[Render polling RunPod]", e);
    }
  } else if (
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
  } else if (
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
  }

  return NextResponse.json(render);
}

// DELETE /api/renders/:id — admin only
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }
  const { id } = await params;
  const render = await prisma.render.findUnique({ where: { id } });
  if (!render) return NextResponse.json({ error: "Render introuvable" }, { status: 404 });
  await prisma.render.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
