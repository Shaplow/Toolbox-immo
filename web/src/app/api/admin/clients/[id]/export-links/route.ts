/**
 * GET  /api/admin/clients/[id]/export-links — liens de téléchargement du client.
 * POST /api/admin/clients/[id]/export-links — crée un lien ; le jeton brut
 *      (rawToken) n'est renvoyé qu'ici, il n'est jamais stocké.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import { validateBody } from "@/lib/validation/apiSchemas";
import { SHARED_SENTINEL_IDS } from "@/lib/rotation/sentinels";
import { createExportLink, listExportLinks } from "@/lib/services/clientExport/exportLinks";
import { createExportLinkSchema } from "@/lib/clientExport/schemas";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  const { id } = await params;
  const client = await prisma.client.findUnique({ where: { id }, select: { id: true } });
  if (!client) return NextResponse.json({ error: "Client introuvable" }, { status: 404 });

  return NextResponse.json({ links: await listExportLinks(id) });
}

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  const { id } = await params;
  const parsed = await validateBody(req, createExportLinkSchema);
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const body = parsed.data;

  const accountIds = [...new Set(body.accountIds)];
  const mediaLibraryIds = [...new Set(body.mediaLibraryIds)];
  const dataLibraryIds = [...new Set(body.dataLibraryIds)];

  const [client, accounts, mediaLibraries, dataLibraries] = await Promise.all([
    prisma.client.findUnique({ where: { id }, select: { id: true } }),
    prisma.instagramAccount.findMany({
      where: { id: { in: accountIds, notIn: [...SHARED_SENTINEL_IDS] }, clientId: id },
      select: { id: true },
    }),
    prisma.mediaLibrary.findMany({
      where: { id: { in: mediaLibraryIds }, type: { in: ["video", "audio"] } },
      select: { id: true },
    }),
    prisma.dataLibrary.findMany({ where: { id: { in: dataLibraryIds } }, select: { id: true } }),
  ]);

  if (!client) return NextResponse.json({ error: "Client introuvable" }, { status: 404 });
  // Un compte d'un autre client glissé dans la requête ouvrirait ses médias : refus net.
  if (accounts.length !== accountIds.length) {
    return NextResponse.json({ error: "Un compte coché n'est pas rattaché à ce client" }, { status: 400 });
  }
  if (mediaLibraries.length !== mediaLibraryIds.length || dataLibraries.length !== dataLibraryIds.length) {
    return NextResponse.json({ error: "Une bibliothèque cochée n'existe plus" }, { status: 400 });
  }

  try {
    const result = await createExportLink({
      selection: { clientId: id, accountIds, mediaLibraryIds, dataLibraryIds, includePublications: body.includePublications },
      label: body.label?.trim() || null,
      expiresInDays: body.expiresInDays,
      createdByUserId: auth.ctx.actualUser.id,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error(`[admin/clients/${id}/export-links] POST :`, err);
    return NextResponse.json({ error: "Erreur lors de la création du lien" }, { status: 500 });
  }
}
