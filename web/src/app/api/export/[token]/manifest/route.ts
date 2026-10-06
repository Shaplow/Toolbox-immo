/**
 * GET /api/export/[token]/manifest — liste des fichiers d'un lien d'export.
 *
 * Public : le jeton EST l'authentification (cf. lib/http/publicRoutes.ts).
 * Appelée par la page /export/[token] côté navigateur — c'est ici, et non au
 * GET de la page, que l'ouverture est enregistrée : les robots d'aperçu de
 * lien (WhatsApp, iMessage…) ne chargent pas le JavaScript.
 *
 * Le premier appel peut prendre quelques secondes (tailles des médias
 * historiques retrouvées puis enregistrées) ; le résultat est ensuite en cache.
 */

import { NextRequest, NextResponse } from "next/server";
import { getExportManifest } from "@/lib/services/clientExport/exportManifest";
import { recordExportOpened } from "@/lib/services/clientExport/exportLinks";
import { createPublicExportGuard, NO_STORE_HEADERS } from "@/lib/services/clientExport/publicGuard";

export const dynamic = "force-dynamic";

const guard = createPublicExportGuard({ windowMs: 60_000, max: 20 });

type Params = { params: Promise<{ token: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { token } = await params;
  const auth = await guard(req, token);
  if (auth.response) return auth.response;

  try {
    const manifest = await getExportManifest(auth.link);
    await recordExportOpened(auth.link);
    return NextResponse.json(manifest, { headers: NO_STORE_HEADERS });
  } catch (err) {
    console.error(`[export/manifest] link=${auth.link.id} :`, err);
    return NextResponse.json(
      { error: "Impossible de préparer la liste des fichiers. Réessaie dans un instant." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
