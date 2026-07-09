/**
 * POST /api/publications/[id]/retrigger-transcription?force=true
 *
 * Relance la transcription du montage validé (currentVersion) d'un slot, même
 * si un TranscriptionJob COMPLETED/stale existe déjà (segments illisibles ou
 * périmés). Utilisé par la page /captions/[presetId]/generate quand la
 * transcription résolue ne produit pas de segments exploitables.
 *
 * Accès : ADMIN, ou le MONTEUR/CM assigné au slot (tool CAPTIONS). Pas
 * admin-only — le monteur/CM gère les sous-titres.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { hasTool, TOOLS } from "@/lib/permissions";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { toUserRole } from "@/lib/permissions/role";
import { triggerAutoTranscriptionForVersion } from "@/lib/triggerAutoTranscriptionForVersion";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: RouteContext) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const isAdmin = userContext.canAdminBypass;
  if (!isAdmin && !(await hasTool(userContext.effectiveUser.id, TOOLS.CAPTIONS))) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const { id: slotId } = await params;
  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: {
      id: true,
      assigneeMonteurId: true,
      assigneeCmId: true,
      assigneeVideasteId: true,
      currentVersion: { select: { id: true, fileUrl: true } },
    },
  });

  const role = toUserRole(userContext.effectiveUser.role);
  if (!slot || !canUserAccessSlot(slot, role, userContext.effectiveUser.id)) {
    // 404 anti-énumération (cohérent avec les autres routes slot).
    return NextResponse.json({ error: "Publication introuvable" }, { status: 404 });
  }
  if (!slot.currentVersion?.fileUrl) {
    return NextResponse.json(
      { error: "Aucun montage validé — promeus une version d'abord." },
      { status: 400 },
    );
  }

  // force par défaut : c'est une relance explicite (segments illisibles/périmés).
  const force = new URL(req.url).searchParams.get("force") !== "false";

  try {
    await triggerAutoTranscriptionForVersion(slot.currentVersion.id, { force });
  } catch (err) {
    console.error(`[retrigger-transcription] échec pour slot=${slotId}:`, err);
    return NextResponse.json(
      { error: "Échec du relancement de la transcription. Réessaie dans un instant." },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, versionId: slot.currentVersion.id });
}
