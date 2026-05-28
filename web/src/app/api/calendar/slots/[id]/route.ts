/**
 * GET    /api/calendar/slots/[id] — lecture d'un slot (scopée par rôle)
 * PATCH  /api/calendar/slots/[id] — mise à jour d'un slot (champs filtrés par rôle)
 * DELETE /api/calendar/slots/[id] — suppression d'un slot (admin uniquement)
 *
 * Filtrage par rôle :
 *   - GET    : 404 si l'utilisateur n'a pas accès au slot (évite l'énumération).
 *   - PATCH  : 404 si pas accès ; champs du body filtrés via ALLOWED_PATCH_FIELDS_BY_ROLE
 *              avant l'update (champs non autorisés ignorés silencieusement).
 *              La logique métier vit dans `services/slot/slotService.patchSlot`.
 *   - DELETE : réservé ADMIN ; 404 pour les non-admin (cohérence avec GET).
 *
 * L'impersonation s'applique : la vue est celle de effectiveUser. Un admin qui
 * impersonne un MONTEUR verra et modifiera uniquement les slots assignés à ce MONTEUR.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { toUserRole } from "@/lib/permissions/role";
import { patchSlot } from "@/lib/services/slot/slotService";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";

/** Safely parse a JSON string. Returns `fallback` if the string is falsy or invalid. */
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
      account: { select: { id: true, name: true, handle: true } },
      template: { select: { id: true, name: true } },
      render: { select: { id: true, status: true, pngUrl: true, videoUrl: true } },
    },
  });

  // 404 systématique : slot inexistant OU pas accessible selon le rôle.
  // On ne distingue pas les deux cas pour éviter l'énumération de slots.
  if (!slot || !canUserAccessSlot(slot, role, userId)) {
    return NextResponse.json({ error: "Slot introuvable" }, { status: 404 });
  }

  return NextResponse.json({
    ...slot,
    fields: safeJSON<Record<string, string>>(slot.fields, {}),
    fieldSchema: safeJSON<string[]>(slot.fieldSchema, []),
  });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await params;

  let rawBody: Record<string, unknown>;
  try {
    rawBody = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  try {
    const updated = await patchSlot(id, rawBody, userContext);
    return NextResponse.json(updated);
  } catch (err) {
    return mapServiceError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const role = toUserRole(userContext.effectiveUser.role);
  const { id } = await params;

  // DELETE réservé ADMIN. On renvoie 404 (pas 403) pour cohérence avec GET/PATCH :
  // un non-admin ne sait pas si le slot existe.
  if (role !== "ADMIN") {
    return NextResponse.json({ error: "Slot introuvable" }, { status: 404 });
  }

  const slot = await prisma.publicationSlot.findUnique({ where: { id } });
  if (!slot) {
    return NextResponse.json({ error: "Slot introuvable" }, { status: 404 });
  }

  await prisma.publicationSlot.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
