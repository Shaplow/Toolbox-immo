/**
 * GET /api/publications/[id] — fiche complète d'un slot de publication
 *
 * Retourne le slot avec toutes les relations nécessaires au hub de publication :
 *   - slot (tous les champs)
 *   - recipe (infos pour computePublicationSteps)
 *   - account (id, handle, name, offre, client { name })
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
import type { UserRole } from "@/types/roles";
import { USER_ROLES } from "@/types/roles";

/** Normalise un rôle brut vers UserRole. Valeur inconnue → USER. */
function toUserRole(raw?: string | null): UserRole {
  if (raw && Object.hasOwn(USER_ROLES, raw)) return raw as UserRole;
  return "USER";
}

/** Safely parse a JSON string. Returns `fallback` if falsy or invalid. */
function safeJSON<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}

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
          offre: true,
          client: { select: { name: true } },
        },
      },
      recipe: {
        select: {
          id: true,
          code: true,
          label: true,
          source: true,
          needsCover: true,
          needsCaptions: true,
          needsDescription: true,
          needsClientValidation: true,
        },
      },
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
    },
  });

  // 404 systématique : slot inexistant OU pas accessible selon le rôle (anti-énumération).
  if (!slot || !canUserAccessSlot(slot, role, userId)) {
    return NextResponse.json({ error: "Slot introuvable" }, { status: 404 });
  }

  // Calcul des steps côté serveur pour que le client n'ait pas à les dériver.
  const steps = computePublicationSteps({
    slot: { status: slot.status, caption: slot.caption },
    recipe: slot.recipe ?? null,
    renderJob: slot.render ?? null,
    coverPack: slot.render?.coverFramePack ?? null,
    // captionJob et descriptionJob ne sont pas liés directement au slot via FK.
    // Ils seront passés dans une logique séparée si nécessaire (Phase 1.4+).
    captionJob: null,
    descriptionJob: null,
  });

  return NextResponse.json({
    ...slot,
    fields: safeJSON<Record<string, string>>(slot.fields, {}),
    fieldSchema: safeJSON<string[]>(slot.fieldSchema, []),
    steps,
  });
}
