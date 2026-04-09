import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { startRenderGeneration } from "@/lib/renderer/generateRender";

type Params = { params: Promise<{ id: string }> };

// POST /api/renders/:id/generate — appelé en interne pour déclencher le rendu
export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;

  const kickoff = await startRenderGeneration(id);
  if (kickoff === "missing") {
    return NextResponse.json({ error: "Render introuvable" }, { status: 404 });
  }
  if (kickoff === "already-processed") {
    const render = await prisma.render.findUnique({ where: { id } });
    return NextResponse.json({ message: "Déjà traité", status: render?.status ?? null });
  }

  return NextResponse.json({ accepted: true }, { status: 202 });
}
