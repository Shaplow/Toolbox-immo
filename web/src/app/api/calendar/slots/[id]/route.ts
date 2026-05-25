/**
 * GET    /api/calendar/slots/[id] — lecture d'un slot (scopée par rôle)
 * PATCH  /api/calendar/slots/[id] — mise à jour d'un slot (champs filtrés par rôle)
 * DELETE /api/calendar/slots/[id] — suppression d'un slot (admin uniquement)
 *
 * Filtrage par rôle (commit 1.2.2) :
 *   - GET  : 404 si l'utilisateur n'a pas accès au slot (évite l'énumération).
 *   - PATCH : 404 si pas accès ; champs du body filtrés via ALLOWED_PATCH_FIELDS_BY_ROLE
 *             avant l'update (champs non autorisés ignorés silencieusement).
 *   - DELETE : réservé ADMIN ; 404 pour les non-admin (cohérence avec GET).
 *
 * On utilise auth() directement afin d'isoler sur le rôle réel de l'utilisateur
 * connecté, indépendamment de toute impersonation.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canUserAccessSlot, ALLOWED_PATCH_FIELDS_BY_ROLE } from "@/lib/permissions/slotScope";
import type { UserRole } from "@/types/roles";
import { USER_ROLES, SLOT_STATUSES } from "@/types/roles";

/** Safely parse a JSON string. Returns `fallback` if the string is falsy or invalid. */
function safeJSON<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}

/** Normalise un rôle brut (String en base) vers UserRole. Valeur inconnue → USER. */
function toUserRole(raw?: string | null): UserRole {
  if (raw && raw in USER_ROLES) return raw as UserRole;
  return "USER";
}

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const role = toUserRole(session.user.role);
  const userId = session.user.id;
  const { id } = await params;

  const slot = await prisma.publicationSlot.findUnique({
    where: { id },
    include: {
      account: { select: { id: true, name: true, handle: true, offre: true } },
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
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const role = toUserRole(session.user.role);
  const userId = session.user.id;
  const { id } = await params;

  const slot = await prisma.publicationSlot.findUnique({
    where: { id },
    select: { id: true, assigneeMonteurId: true, assigneeCmId: true },
  });

  // 404 systématique : slot inexistant OU pas accessible selon le rôle.
  if (!slot || !canUserAccessSlot(slot, role, userId)) {
    return NextResponse.json({ error: "Slot introuvable" }, { status: 404 });
  }

  const rawBody = (await req.json()) as Record<string, unknown>;

  // Filtrer les champs du body selon ce que le rôle est autorisé à modifier.
  // Les champs non autorisés sont ignorés silencieusement (pas de 403).
  const allowedFields = ALLOWED_PATCH_FIELDS_BY_ROLE[role];
  const body = Object.fromEntries(
    Object.entries(rawBody).filter(([key]) => allowedFields.includes(key))
  );

  const { status, title, caption, notes, templateId, scheduledAt, contentType, fields, fieldSchema,
          assigneeMonteurId, assigneeCmId, recipeId, currentVersionId, isAuto } = body as Record<string, unknown>;

  // Validation du statut : doit être une valeur de SLOT_STATUSES si fourni.
  if (status !== undefined && (typeof status !== "string" || !(status in SLOT_STATUSES))) {
    return NextResponse.json(
      { error: `Statut invalide. Valeurs acceptées : ${Object.keys(SLOT_STATUSES).join(", ")}` },
      { status: 400 }
    );
  }

  if (scheduledAt !== undefined && typeof scheduledAt === "string" && isNaN(new Date(scheduledAt).getTime())) {
    return NextResponse.json({ error: "scheduledAt invalide" }, { status: 400 });
  }

  const updated = await prisma.publicationSlot.update({
    where: { id },
    data: {
      ...(status !== undefined ? { status: status as string } : {}),
      ...(title !== undefined ? { title: title as string | null } : {}),
      ...(caption !== undefined ? { caption: caption as string | null } : {}),
      ...(notes !== undefined ? { notes: notes as string | null } : {}),
      ...(templateId !== undefined ? { templateId: templateId as string | null } : {}),
      ...(scheduledAt !== undefined ? { scheduledAt: new Date(scheduledAt as string) } : {}),
      ...(contentType !== undefined ? { contentType: contentType as string } : {}),
      ...(fields !== undefined ? { fields: JSON.stringify(fields) } : {}),
      ...(fieldSchema !== undefined ? { fieldSchema: JSON.stringify(fieldSchema) } : {}),
      ...(assigneeMonteurId !== undefined ? { assigneeMonteurId: assigneeMonteurId as string | null } : {}),
      ...(assigneeCmId !== undefined ? { assigneeCmId: assigneeCmId as string | null } : {}),
      ...(recipeId !== undefined ? { recipeId: recipeId as string | null } : {}),
      ...(currentVersionId !== undefined ? { currentVersionId: currentVersionId as string | null } : {}),
      ...(isAuto !== undefined ? { isAuto: isAuto as boolean } : {}),
    },
    include: {
      account: { select: { id: true, name: true, handle: true, offre: true } },
      template: { select: { id: true, name: true } },
      render: { select: { id: true, status: true, pngUrl: true, videoUrl: true } },
    },
  });

  return NextResponse.json({
    ...updated,
    fields: safeJSON<Record<string, string>>(updated.fields, {}),
    fieldSchema: safeJSON<string[]>(updated.fieldSchema, []),
  });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const role = toUserRole(session.user.role);
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
