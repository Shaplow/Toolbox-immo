/**
 * POST /api/publications/[id]/cover/manual-select
 *
 * V8.1.1 — Ferme la boucle pour le mode pattern.coverMode = "manualSelect".
 *
 * Contexte : avant, le mode manualSelect envoyait l'admin sur l'onglet
 * "extraction libre" du CoverGenerator où il pouvait juste télécharger des
 * frames en PNG, sans moyen d'en faire la "cover finale" du slot. Le pack
 * du slot restait vide, la fiche ne montrait jamais de cover.
 *
 * Cette route reçoit une frame extraite (URL R2 ou data URL) et la promeut
 * comme cover finale du slot :
 *  1. Trouve un CoverFramePack existant non-stale pour ce slot (via render
 *     OU version selon mode pattern), OU en crée un.
 *  2. Update status=SELECTED + finalCoverUrl=frameUrl + reset stale.
 *  3. Promote pack via slot.activeCoverPackId (helper V6.2).
 *  4. Log COVER_COMPLETED activity.
 *
 * Pas de rendu composite avec overlay text : pour le mode manualSelect, la
 * frame extraite EST la cover finale telle quelle. Si l'admin veut un
 * composite avec text overlay, il doit utiliser autoPack.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { toUserRole } from "@/lib/permissions/role";
import { hasTool, TOOLS } from "@/lib/permissions";
import { logActivity } from "@/lib/services/slot/activity";
import { promoteCoverPack } from "@/lib/publications/jobLifecycle";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;

  const isAdmin = userContext.canAdminBypass;
  if (!isAdmin && !(await hasTool(userContext.effectiveUser.id, TOOLS.COVERS))) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const { id: slotId } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    frameUrl?: string;
    timestamp?: number;
  };

  if (!body.frameUrl || typeof body.frameUrl !== "string") {
    return NextResponse.json({ error: "frameUrl requis" }, { status: 400 });
  }

  // Validation slot + accès (404 anti-énumération).
  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: {
      id: true,
      assigneeMonteurId: true,
      assigneeCmId: true,
      assigneeVideasteId: true,
      currentVersionId: true,
      render: { select: { id: true, templateId: true } },
    },
  });
  const role = toUserRole(userContext.effectiveUser.role);
  if (!slot || !canUserAccessSlot(slot, role, userContext.effectiveUser.id)) {
    return NextResponse.json({ error: "Publication introuvable" }, { status: 404 });
  }

  // Chercher un pack non-stale existant pour ce slot (via render OU version).
  const existingPack = await prisma.coverFramePack.findFirst({
    where: {
      OR: [
        { render: { publicationSlotId: slotId } },
        { publicationVersion: { slotId } },
      ],
      staleSince: null,
    },
    select: { id: true, renderId: true, publicationVersionId: true },
  });

  let packId: string;
  if (existingPack) {
    // Update existing : promotion d'une nouvelle frame manuelle sur un pack
    // déjà créé (par exemple un pack autoPack qu'on ré-sélectionne en mode
    // manuel après changement de mode pattern).
    await prisma.coverFramePack.update({
      where: { id: existingPack.id },
      data: {
        status: "SELECTED",
        finalCoverUrl: body.frameUrl,
        finalCoverKey: null, // frame manuelle = pas de clé R2 dédiée
        selectedCandidateId: null, // pas de candidate DB pour manual
        errorMsg: null,
        staleSince: null,
        staleReason: null,
      },
    });
    packId = existingPack.id;
  } else {
    // Create new pack en SELECTED direct (skip QUEUED/PROCESSING).
    // Attache au render (auto_template) OU à la version (manual_rushes /
    // external_upload). L'un des deux doit exister, sinon erreur.
    if (!slot.render?.id && !slot.currentVersionId) {
      return NextResponse.json(
        {
          error:
            "Slot sans render ni version courante — impossible de rattacher une cover. Promote une version ou lance un render avant.",
        },
        { status: 400 },
      );
    }
    const newPack = await prisma.coverFramePack.create({
      data: {
        userId: userContext.effectiveUser.id,
        // Préfère renderId si dispo (auto_template), sinon versionId.
        renderId: slot.render?.id ?? null,
        publicationVersionId: slot.render?.id ? null : slot.currentVersionId,
        templateId: slot.render?.templateId ?? null,
        status: "SELECTED",
        finalCoverUrl: body.frameUrl,
        config: JSON.stringify({ mode: "manual" }),
        overlayGroupIds: JSON.stringify([]),
        frameCount: 0,
      },
      select: { id: true },
    });
    packId = newPack.id;
  }

  // Promote actif au slot (V6.2 helper).
  await promoteCoverPack(prisma, slotId, packId);

  // Log activity.
  await logActivity(prisma, {
    slotId,
    actorId: userContext.actualUser.id,
    type: "COVER_COMPLETED",
    payload: {
      coverFramePackId: packId,
      finalCoverUrl: body.frameUrl,
      mode: "manual",
      timestamp: body.timestamp ?? null,
    },
  });

  return NextResponse.json({ ok: true, packId, finalCoverUrl: body.frameUrl });
}
