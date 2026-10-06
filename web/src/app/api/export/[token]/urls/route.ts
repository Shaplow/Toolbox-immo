/**
 * POST /api/export/[token]/urls — URLs de téléchargement pour quelques fichiers.
 *
 * Body : { refs: string[] } (≤ 20). La page les demande juste avant chaque
 * fichier : une URL signée n'attend jamais assez pour expirer, et une
 * révocation coupe le téléchargement au fichier suivant.
 *
 * Seules les refs du manifeste du lien sont signées (anti-IDOR) ; les autres
 * reviennent dans `missing`.
 */

import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/validation/apiSchemas";
import { exportUrlsSchema } from "@/lib/clientExport/schemas";
import { signExportRefs } from "@/lib/services/clientExport/exportManifest";
import { createPublicExportGuard, NO_STORE_HEADERS } from "@/lib/services/clientExport/publicGuard";

export const dynamic = "force-dynamic";

// Une URL par fichier, 3 fichiers en parallèle : des centaines de petits sons
// peuvent demander plusieurs URLs par seconde. La signature est locale et le
// manifeste en cache : la limite ne sert qu'à freiner un script.
const guard = createPublicExportGuard({ windowMs: 60_000, max: 600 });

type Params = { params: Promise<{ token: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { token } = await params;
  const auth = await guard(req, token);
  if (auth.response) return auth.response;

  const parsed = await validateBody(req, exportUrlsSchema);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400, headers: NO_STORE_HEADERS });
  }

  try {
    const result = await signExportRefs(auth.link, token, [...new Set(parsed.data.refs)]);
    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (err) {
    console.error(`[export/urls] link=${auth.link.id} :`, err);
    return NextResponse.json(
      { error: "Impossible de préparer le téléchargement. Réessaie dans un instant." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
