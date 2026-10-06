/**
 * GET /api/admin/clients/[id]/export-preview — volumes exportables du client,
 * par bibliothèque et par compte, pour le tiroir « Nouveau lien de
 * téléchargement ». Mêmes règles de périmètre que le lien lui-même.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import { buildExportPreview } from "@/lib/services/clientExport/exportPreview";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  const { id } = await params;
  const client = await prisma.client.findUnique({ where: { id }, select: { id: true } });
  if (!client) return NextResponse.json({ error: "Client introuvable" }, { status: 404 });

  try {
    return NextResponse.json(await buildExportPreview(id));
  } catch (err) {
    console.error(`[admin/clients/${id}/export-preview] :`, err);
    return NextResponse.json({ error: "Impossible de calculer les volumes" }, { status: 500 });
  }
}
