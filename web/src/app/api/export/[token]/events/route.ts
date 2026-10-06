/**
 * POST /api/export/[token]/events — bilan envoyé par la page publique.
 *
 * `started` à chaque lancement (reprises comprises), `completed` / `stopped`
 * en fin de session avec le bilan : l'admin voit sur la fiche client que le
 * client a bien tout récupéré.
 */

import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/validation/apiSchemas";
import { exportEventSchema } from "@/lib/clientExport/schemas";
import { recordExportEvent } from "@/lib/services/clientExport/exportLinks";
import { createPublicExportGuard, NO_STORE_HEADERS } from "@/lib/services/clientExport/publicGuard";

export const dynamic = "force-dynamic";

const guard = createPublicExportGuard({ windowMs: 60_000, max: 30 });

type Params = { params: Promise<{ token: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { token } = await params;
  const auth = await guard(req, token);
  if (auth.response) return auth.response;

  const parsed = await validateBody(req, exportEventSchema);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400, headers: NO_STORE_HEADERS });
  }

  try {
    await recordExportEvent(auth.link.id, parsed.data);
    return new NextResponse(null, { status: 204, headers: NO_STORE_HEADERS });
  } catch (err) {
    console.error(`[export/events] link=${auth.link.id} :`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
