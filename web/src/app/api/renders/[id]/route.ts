import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getR2PublicUrl } from "@/lib/r2";

type Params = { params: Promise<{ id: string }> };

const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID;

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
  const { id } = await params;

  let render = await prisma.render.findUnique({ where: { id } });
  if (!render) return NextResponse.json({ error: "Render introuvable" }, { status: 404 });

  // Vérifier ownership via listing (admin peut voir tous les renders)
  const isAdmin = session.user.role === "ADMIN";
  if (!isAdmin) {
    const listing = await prisma.listing.findFirst({
      where: { id: render.listingId, userId: session.user.id },
    });
    if (!listing) return NextResponse.json({ error: "Render introuvable" }, { status: 404 });
  }

  // ─── Polling RunPod (renders vidéo en cours) ────────────────────────────
  if (render.runpodJobId && render.status === "PROCESSING" && RUNPOD_API_KEY && RUNPOD_ENDPOINT_ID) {
    try {
      const rp = await fetchRunpodStatus(render.runpodJobId);
      if (rp.status === "COMPLETED") {
        const videoUrl = rp.output?.video_url ?? (rp.output?.output_key ? getR2PublicUrl(rp.output.output_key) : null);
        render = await prisma.render.update({
          where: { id },
          data: { status: "DONE", videoUrl: videoUrl ?? undefined },
        });
      } else if (["FAILED", "CANCELLED", "TIMED_OUT"].includes(rp.status)) {
        render = await prisma.render.update({
          where: { id },
          data: { status: "ERROR", errorMsg: rp.error ?? `RunPod job ${rp.status}` },
        });
      }
      // IN_QUEUE / IN_PROGRESS → on retourne le statut courant
    } catch (e) {
      console.error("[Render polling RunPod]", e);
    }
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
