import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { getUserContext } from "@/lib/userContext";
import { buildCoverOverlayPreviewHtml, getCoverOverlayCanvasDimensions } from "@/lib/coverAuto";
import { hasTool, TOOLS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { renderPNG } from "@/lib/renderer/renderPNG";
import { getR2PublicUrl, objectExistsInR2, r2Configured, uploadToR2 } from "@/lib/r2";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

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
  const html = await buildCoverOverlayPreviewHtml(id);
  const { width, height } = await getCoverOverlayCanvasDimensions(id);

  // Cache R2 : l'overlay ne dépend que de l'état persistant du pack (groupes,
  // offset…). On le rastérise (Chromium) UNE seule fois par configuration — la
  // clé R2 est un hash du HTML rendu — puis on sert depuis R2. Les vues suivantes
  // avec la même config ne relancent plus jamais Chromium (le vrai coût), ce qui
  // évite la « storm » de N navigateurs quand plusieurs packs s'affichent.
  // Toute erreur R2 → fallback rendu direct : l'aperçu ne casse jamais.
  if (r2Configured()) {
    try {
      const hash = createHash("sha1").update(`${width}x${height}:${html}`).digest("hex");
      const key = `covers/overlays/${id}/${hash}.png`;
      if (!(await objectExistsInR2(key))) {
        const png = await renderPNG(html, width, height, 1, true);
        await uploadToR2(key, png, "image/png", png.byteLength);
      }
      // Rebond vers l'objet R2 (public, même posture que les frames candidates ;
      // clé non devinable) — décharge les octets du process Node.
      return NextResponse.redirect(getR2PublicUrl(key), { status: 302 });
    } catch (err) {
      console.warn(`[cover-overlay] cache R2 indisponible → rendu direct pack=${id}:`, err);
    }
  }

  // Fallback (R2 non configuré en dev, ou erreur R2) : rendu direct, PNG en cache
  // navigateur (1h) — regeneré uniquement si le pack change.
  const png = await renderPNG(html, width, height, 1, true);
  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
