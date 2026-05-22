import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { buildCoverOverlayPreviewHtml } from "@/lib/coverAuto";
import { hasTool, TOOLS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
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

  const html = await buildCoverOverlayPreviewHtml(id);
  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
