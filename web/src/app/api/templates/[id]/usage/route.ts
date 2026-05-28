/**
 * GET /api/templates/:id/usage
 *
 * Liste les AccountPattern qui utilisent ce template (templateId = id), pour
 * rendre visible dans le builder l'impact d'un changement de config Auto
 * Captions / Auto Cover sur les publications.
 *
 * Retour :
 *   { patterns: Array<{
 *       id, label, isActive, accountId, accountHandle, accountName,
 *       captionPresetId | null,
 *       coverPresetName | null,  // résolu depuis coverConfig.coverPresetName
 *     }> }
 *
 * Sécurité :
 *  - Admin uniquement (les non-admins n'ont pas besoin de cette info dans
 *    le builder, qui leur reste accessible pour leurs propres templates).
 *  - 401 si non connecté, 403 si non-admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  if (!userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;

  const patterns = await prisma.accountPattern.findMany({
    where: { templateId: id },
    select: {
      id: true,
      label: true,
      isActive: true,
      captionPresetId: true,
      coverConfig: true,
      account: { select: { id: true, handle: true, name: true } },
    },
    orderBy: [{ isActive: "desc" }, { label: "asc" }],
  });

  const result = patterns.map((p) => {
    const cfg = (p.coverConfig as { enabled?: boolean; coverPresetName?: string } | null) ?? {};
    return {
      id: p.id,
      label: p.label,
      isActive: p.isActive,
      accountId: p.account.id,
      accountHandle: p.account.handle,
      accountName: p.account.name,
      captionPresetId: p.captionPresetId,
      coverPresetName: cfg.coverPresetName ?? null,
      coverEnabled: cfg.enabled === true,
    };
  });

  return NextResponse.json({ patterns: result });
}
