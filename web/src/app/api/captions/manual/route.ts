/**
 * POST /api/captions/manual
 *
 * V8.2.5 — Sauvegarde des sous-titres écrits à la main pour un slot dont le
 * pattern est en mode `needsCaptionsMode = "manual"`.
 *
 * Contexte : avant V8, `pattern.needsCaptions` était un Boolean — true =
 * pipeline auto (preset + Whisper + burn-in via RunPod). Aucune branche pour
 * écrire les sous-titres à la main. V8 introduit l'enum "none/auto/manual" ;
 * cette route est le receiver pour le mode "manual".
 *
 * Body :
 *   { slotId: string, srtContent: string }
 *
 * Logique :
 *   1. Auth + accès slot (canUserAccessSlot, 404 anti-énumération).
 *   2. Vérifie que le pattern résolu est en mode "manual" (sinon 400 — l'UI
 *      ne devrait pas appeler cette route en mode auto).
 *   3. Cherche un CaptionJob non-stale rattaché à ce slot. Si existe → update
 *      srtContent + status COMPLETED. Sinon → create CaptionJob COMPLETED.
 *   4. `promoteCaptionJob(slotId, job.id)` pour pointer activeCaptionJobId.
 *   5. logActivity CAPTIONS_COMPLETED avec mode: "manual".
 *
 * Pas de burn-in vidéo : on stocke juste le SRT sur le slot. Le mode auto
 * reste réservé pour générer une vidéo finale avec captions incrustés via
 * preset + RunPod. Pour le mode manual, le SRT est consultable depuis la
 * fiche (et téléchargeable plus tard si besoin).
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { toUserRole } from "@/lib/permissions/role";
import { hasTool, TOOLS } from "@/lib/permissions";
import { logActivity } from "@/lib/services/slot/activity";
import { promoteCaptionJob } from "@/lib/publications/jobLifecycle";
import { resolveCaptionsMode } from "@/lib/publications/captionsMode";
import { slotEffectivePatternSelect, resolveSlotEffectivePattern } from "@/lib/services/slot/effectivePattern";

export async function POST(req: NextRequest) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const isAdmin = userContext.canAdminBypass;
  if (!isAdmin && !(await hasTool(userContext.effectiveUser.id, TOOLS.CAPTIONS))) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    slotId?: string;
    srtContent?: string;
  };

  if (!body.slotId || typeof body.slotId !== "string") {
    return NextResponse.json({ error: "slotId requis" }, { status: 400 });
  }
  if (typeof body.srtContent !== "string") {
    return NextResponse.json({ error: "srtContent requis (string)" }, { status: 400 });
  }

  // Charge slot + pattern pour vérification mode + accès.
  const slot = await prisma.publicationSlot.findUnique({
    where: { id: body.slotId },
    select: {
      id: true,
      assigneeMonteurId: true,
      assigneeCmId: true,
      assigneeVideasteId: true,
      needsCaptionsOverride: true,
      needsCaptionsModeOverride: true,
      ...slotEffectivePatternSelect,
    },
  });
  const role = toUserRole(userContext.effectiveUser.role);
  if (!slot || !canUserAccessSlot(slot, role, userContext.effectiveUser.id)) {
    return NextResponse.json({ error: "Publication introuvable" }, { status: 404 });
  }

  const effPattern = resolveSlotEffectivePattern(slot);
  const mode = resolveCaptionsMode({
    slot: {
      needsCaptionsModeOverride: slot.needsCaptionsModeOverride,
      needsCaptionsOverride: slot.needsCaptionsOverride,
    },
    pattern: effPattern,
  });
  if (mode !== "manual") {
    return NextResponse.json(
      {
        error:
          "Cette route est réservée au mode captions « manuel ». Mode actuel : " +
          mode +
          ". Passe par le pipeline auto (preset) à la place.",
      },
      { status: 400 },
    );
  }

  // Cherche un job non-stale existant pour ce slot (peu importe son status :
  // si l'éditeur sauvegarde plusieurs fois, on update le même row).
  const existingJob = await prisma.captionJob.findFirst({
    where: { slotId: body.slotId, staleSince: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  let jobId: string;
  if (existingJob) {
    await prisma.captionJob.update({
      where: { id: existingJob.id },
      data: {
        status: "COMPLETED",
        srtContent: body.srtContent,
        errorMsg: null,
      },
    });
    jobId = existingJob.id;
  } else {
    const created = await prisma.captionJob.create({
      data: {
        userId: userContext.effectiveUser.id,
        slotId: body.slotId,
        status: "COMPLETED",
        srtContent: body.srtContent,
        // Pas de burn-in vidéo en mode manuel : outputUrl/Key restent null.
        config: JSON.stringify({ mode: "manual" }),
      },
      select: { id: true },
    });
    jobId = created.id;
  }

  await promoteCaptionJob(prisma, body.slotId, jobId);

  await logActivity(prisma, {
    slotId: body.slotId,
    actorId: userContext.actualUser.id,
    type: "CAPTIONS_COMPLETED",
    payload: { captionJobId: jobId, mode: "manual" },
  });

  return NextResponse.json({ ok: true, jobId });
}
