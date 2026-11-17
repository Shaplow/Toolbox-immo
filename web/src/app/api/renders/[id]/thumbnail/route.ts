import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import { getRenderThumbnail } from "@/lib/renderer/renderThumbnail";
import { captureError } from "@/lib/observability/captureError";

type Params = { params: Promise<{ id: string }> };

function notFound() {
  return NextResponse.json({ error: "Vignette introuvable" }, { status: 404 });
}

// GET /api/renders/:id/thumbnail — vignette WebP d'un render image (« Mes générations »).
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const { ctx } = auth;
  const { id } = await params;

  const render = await prisma.render.findUnique({
    where: { id },
    select: { id: true, pngUrl: true, listing: { select: { userId: true } } },
  });
  // Même règle que GET /api/renders/:id : le propriétaire du listing, ou un admin.
  if (!render || (!ctx.canAdminBypass && render.listing.userId !== ctx.effectiveUser.id)) {
    return notFound();
  }

  let thumbnail: Buffer | null;
  try {
    thumbnail = await getRenderThumbnail(render.id, render.pngUrl);
  } catch (err) {
    captureError(err, { tag: "render-thumbnail", extra: { renderId: render.id } });
    return NextResponse.json({ error: "Vignette indisponible" }, { status: 500 });
  }
  if (!thumbnail) return notFound();

  return new NextResponse(new Uint8Array(thumbnail), {
    headers: {
      "Content-Type": "image/webp",
      // Le PNG d'un render n'est jamais réécrit : sa vignette non plus.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
