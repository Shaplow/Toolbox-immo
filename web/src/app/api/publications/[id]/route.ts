/**
 * GET /api/publications/[id] — fiche complète d'un slot de publication
 *
 * Retourne le slot avec toutes les relations nécessaires au hub de publication :
 *   - slot (tous les champs)
 *   - pattern (infos pour computePublicationSteps)
 *   - account (id, handle, name, client { name })
 *   - listing (id, jsonData)
 *   - assigneeMonteur / assigneeCm (id, name, email)
 *   - render (le plus récent : id, status, videoUrl, pngUrl, createdAt)
 *   - coverFramePack (via render : id, status, finalCoverUrl)
 *   - steps calculés par computePublicationSteps
 *
 * Auth : session obligatoire → 401. canUserAccessSlot → 404 (anti-énumération).
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { computePublicationSteps } from "@/lib/publications/steps";
import { toLegacyPatternShape } from "@/lib/services/pattern/resolveEffective";
import { toUserRole } from "@/lib/permissions/role";
import { safeJSON } from "@/lib/utils/json";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id } = await params;

  const slot = await prisma.publicationSlot.findUnique({
    where: { id },
    include: {
      account: {
        select: {
          id: true,
          handle: true,
          name: true,
          client: { select: { name: true } },
        },
      },
      pattern: {
        select: {
          id: true,
          label: true,
          source: true,
          coverMode: true,
          needsCaptions: true,
          needsCaptionsMode: true,
          needsDescription: true,
          needsClientValidation: true,
          needsRushes: true,
          needsBrief: true,
        },
      },
      // Recette par compte : binding + template pour synthétiser le pattern
      // effectif quand le slot n'a pas d'AccountPattern legacy.
      patternBinding: { include: { patternTemplate: true } },
      template: { select: { id: true, name: true } },
      assigneeMonteur: { select: { id: true, name: true, email: true } },
      assigneeCm: { select: { id: true, name: true, email: true } },
      render: {
        select: {
          id: true,
          status: true,
          videoUrl: true,
          pngUrl: true,
          createdAt: true,
          coverFramePack: {
            select: { id: true, status: true, finalCoverUrl: true },
          },
          listing: { select: { id: true, jsonData: true } },
        },
      },
      captionJobs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true },
      },
      descriptionJobs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true, result: true },
      },
      // W5.3 : versionsCount via _count pour pouvoir l'injecter dans
      // computePublicationSteps. Avant : versionsCount hardcoded à 0 →
      // l'étape "edit" affichait toujours todo, même pour les slots avec
      // versions livrées (finding slot-13).
      _count: { select: { versions: { where: { deletedAt: null } } } },
    },
  });

  // 404 systématique : slot inexistant OU pas accessible selon le rôle (anti-énumération).
  if (!slot || !canUserAccessSlot(slot, role, userId)) {
    return NextResponse.json({ error: "Slot introuvable" }, { status: 404 });
  }

  // Pattern effectif : AccountPattern legacy OU recette PatternBinding (G.3).
  // Sans ce fallback, les slots créés via recette (pattern legacy null) avaient
  // des steps invisibles (render/cover/description/validation cachés).
  const effPattern =
    slot.pattern ?? (slot.patternBinding ? toLegacyPatternShape(slot.patternBinding) : null);

  // Calcul des steps côté serveur pour que le client n'ait pas à les dériver.
  const steps = computePublicationSteps({
    slot: { status: slot.status, description: slot.description },
    pattern: effPattern,
    renderJob: slot.render ?? null,
    coverPack: slot.render?.coverFramePack ?? null,
    captionJob: slot.captionJobs[0] ?? null,
    descriptionJob: slot.descriptionJobs[0] ?? null,
    versionsCount: slot._count.versions,
    currentVersionId: slot.currentVersionId ?? null,
  });

  return NextResponse.json({
    ...slot,
    // Expose le pattern effectif (legacy OU recette synthétisée) au client.
    pattern: effPattern,
    fields: safeJSON<Record<string, string>>(slot.fields, {}),
    fieldSchema: safeJSON<string[]>(slot.fieldSchema, []),
    steps,
  });
}
