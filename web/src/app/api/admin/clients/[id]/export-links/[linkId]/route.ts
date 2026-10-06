/**
 * PATCH /api/admin/clients/[id]/export-links/[linkId]
 *
 * Body :
 *   { action: "revoke" }              — le client ne peut plus télécharger
 *   { action: "rotate" }              — nouveau jeton (renvoyé une fois), l'ancien
 *                                       lien cesse de marcher ; même sélection
 *   { action: "extend", days: 1..30 } — repousse l'expiration
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import { validateBody } from "@/lib/validation/apiSchemas";
import { mutateExportLink } from "@/lib/services/clientExport/exportLinks";
import { invalidateExportManifest } from "@/lib/services/clientExport/exportManifest";
import { exportLinkActionSchema } from "@/lib/clientExport/schemas";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; linkId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  const { id, linkId } = await params;
  const parsed = await validateBody(req, exportLinkActionSchema);
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const result = await mutateExportLink(id, linkId, parsed.data);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    // Le jeton est refusé dès maintenant (vérifié à chaque appel public) ; on
    // libère aussi le manifeste en cache, devenu inutile.
    if (parsed.data.action === "revoke") invalidateExportManifest(linkId);
    return NextResponse.json({ link: result.link, rawToken: result.rawToken });
  } catch (err) {
    console.error(`[admin/clients/${id}/export-links/${linkId}] PATCH :`, err);
    return NextResponse.json({ error: "Erreur lors de la mise à jour du lien" }, { status: 500 });
  }
}
