import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { startRenderGeneration } from "@/lib/renderer/generateRender";

type Params = { params: Promise<{ id: string }> };

// POST /api/renders/:id/generate — appelé en interne pour déclencher le rendu
// Protégé par INTERNAL_API_KEY (pas de session utilisateur — appel serveur → serveur)
export async function POST(req: NextRequest, { params }: Params) {
  const key = req.headers.get("x-internal-key");
  const expected = process.env.INTERNAL_API_KEY;

  if (!expected) {
    console.error("[renders/generate] INTERNAL_API_KEY env var is not set — all requests rejected");
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const keysMatch =
    key &&
    key.length === expected.length &&
    timingSafeEqual(Buffer.from(key, "utf8"), Buffer.from(expected, "utf8"));

  if (!keysMatch) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

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
