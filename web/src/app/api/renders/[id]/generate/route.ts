import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateRender } from "@/lib/renderer/generateRender";

type Params = { params: Promise<{ id: string }> };

// POST /api/renders/:id/generate — appelé en interne pour déclencher le rendu
export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;

  const render = await prisma.render.findUnique({ where: { id } });
  if (!render) {
    return NextResponse.json({ error: "Render introuvable" }, { status: 404 });
  }
  if (render.status !== "PENDING") {
    return NextResponse.json({ message: "Déjà traité" });
  }

  // Marquer comme PROCESSING
  await prisma.render.update({
    where: { id },
    data: { status: "PROCESSING" },
  });

  try {
    await generateRender(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[generate] Render ${id} FAILED:`, err);
    await prisma.render.update({
      where: { id },
      data: {
        status: "ERROR",
        errorMsg: msg,
      },
    });
    return NextResponse.json({ error: "Échec de la génération" }, { status: 500 });
  }
}
