import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { buildCoverOverlayPreviewHtml, getCoverOverlayCanvasDimensions } from "@/lib/coverAuto";
import { hasTool, TOOLS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { renderPNG } from "@/lib/renderer/renderPNG";
import { IMPERSONATION_COOKIE_NAME, resolveUserContext } from "@/lib/userContext";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const userContext = await resolveUserContext(session, req.cookies.get(IMPERSONATION_COOKIE_NAME)?.value ?? null);
  const isAdmin = userContext.canAdminBypass;
  if (!isAdmin && !(await hasTool(userContext.effectiveUser.id, TOOLS.COVERS))) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const { id } = await params;
  const pack = await prisma.coverFramePack.findUnique({
    where: { id },
    select: { userId: true },
  });
  if (!pack || (!isAdmin && pack.userId !== userContext.effectiveUser.id)) {
    return NextResponse.json({ error: "Pack introuvable" }, { status: 404 });
  }

  // Rendu via Puppeteer (même moteur que le rendu final) pour garantir une
  // correspondance pixel-parfaite des métriques de fonte et du centrage du texte.
  // Le PNG transparent est mis en cache navigateur (1h) — regeneré uniquement si
  // le pack change (nouveau tirage → nouvel id).
  const html = await buildCoverOverlayPreviewHtml(id);
  const { width, height } = await getCoverOverlayCanvasDimensions(id);
  const png = await renderPNG(html, width, height, 1, true);

  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
