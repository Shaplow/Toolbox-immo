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
 * L'impersonation s'applique : la vue est celle de effectiveUser. Un admin qui
 * impersonne un MONTEUR verra et modifiera uniquement les slots assignés à ce MONTEUR.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { canUserAccessSlot, ALLOWED_PATCH_FIELDS_BY_ROLE, isValidSlotStatus } from "@/lib/permissions/slotScope";
import { toUserRole } from "@/lib/permissions/role";
import { logActivity } from "@/lib/publications/activity";

/** Safely parse a JSON string. Returns `fallback` if the string is falsy or invalid. */
function safeJSON<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}

/**
 * Statuts terminaux réservés aux ADMIN uniquement.
 * Un MONTEUR ou CM ne peut pas écrire ces valeurs via PATCH, même si "status"
 * figure dans leurs ALLOWED_PATCH_FIELDS_BY_ROLE. L'escalade vers PUBLISHED
 * se fait exclusivement via POST /api/publications/[id]/mark-published.
 */
const RESERVED_TERMINAL_STATUSES = ["PUBLISHED", "CANCELLED", "ARCHIVED", "REJECTED"] as const;

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

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id } = await params;

  const slot = await prisma.publicationSlot.findUnique({
    where: { id },
    select: { id: true, status: true, assigneeMonteurId: true, assigneeCmId: true },
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

  const { status, title, caption, description, templateId, scheduledAt, fields, fieldSchema,
          assigneeMonteurId, assigneeCmId, patternId, currentVersionId, isAuto } = body as Record<string, unknown>;
  // notes est mutable : peut être sanitisé avant l'update (H2).
  let { notes } = body as Record<string, unknown>;

  // H1 — Guard statuts terminaux réservés.
  // MONTEUR et CM peuvent écrire des statuts de travail (DRAFT, IN_EDIT, etc.)
  // mais PAS les statuts terminaux réservés (PUBLISHED, CANCELLED, ARCHIVED, REJECTED).
  // L'escalade vers PUBLISHED se fait exclusivement via POST mark-published.
  if (
    typeof status === "string" &&
    (RESERVED_TERMINAL_STATUSES as readonly string[]).includes(status) &&
    role !== "ADMIN"
  ) {
    return NextResponse.json(
      { error: "Ce statut est réservé. Utilisez /mark-published ou contactez un admin." },
      { status: 403 }
    );
  }

  // Validation du statut : doit être une valeur de SLOT_STATUSES ou un statut legacy
  // conservé en cohabitation jusqu'au backfill Phase 1.3 (cf isValidSlotStatus).
  if (status !== undefined && !isValidSlotStatus(status)) {
    return NextResponse.json(
      { error: "Statut invalide." },
      { status: 400 }
    );
  }

  if (scheduledAt !== undefined && typeof scheduledAt === "string" && isNaN(new Date(scheduledAt).getTime())) {
    return NextResponse.json({ error: "scheduledAt invalide" }, { status: 400 });
  }

  // E3 — fix M4 mass-assignment : bornes sur les champs texte pour éviter le
  // DoS storage et limiter les payloads XSS différé. Cohérent avec la dette
  // technique active §15.2 (M4 1.3.3).
  const MAX_TEXT_FIELD = 5000;
  for (const [name, value] of [["title", title], ["caption", caption], ["description", description], ["notes", notes]] as const) {
    if (typeof value === "string" && value.length > MAX_TEXT_FIELD) {
      return NextResponse.json(
        { error: `Le champ ${name} dépasse ${MAX_TEXT_FIELD} caractères` },
        { status: 400 }
      );
    }
  }

  // Validation shape `fields` : Record<string, string> avec keys ≤100 chars
  // et values ≤5000 chars. Empêche les structures arbitraires (objet, array,
  // null) et les payloads démesurés.
  if (fields !== undefined) {
    if (typeof fields !== "object" || fields === null || Array.isArray(fields)) {
      return NextResponse.json({ error: "fields doit être un objet" }, { status: 400 });
    }
    const fieldsObj = fields as Record<string, unknown>;
    for (const [key, value] of Object.entries(fieldsObj)) {
      if (key.length > 100) {
        return NextResponse.json(
          { error: `Clé fields trop longue (max 100): ${key.slice(0, 20)}…` },
          { status: 400 }
        );
      }
      if (typeof value !== "string" || value.length > MAX_TEXT_FIELD) {
        return NextResponse.json(
          { error: `Valeur fields["${key}"] doit être string ≤${MAX_TEXT_FIELD} chars` },
          { status: 400 }
        );
      }
    }
  }

  // H2 — Défense en profondeur : sanitizer les notes pour les non-ADMIN.
  // Supprime toute ligne "PUBLISHED_URL:" que le body pourrait contenir,
  // afin d'éviter l'injection de l'ancienne donnée hack via le champ notes.
  if (typeof notes === "string" && role !== "ADMIN") {
    notes = notes
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("PUBLISHED_URL:"))
      .join("\n");
  }

  // M2 — Validation existence + rôle des assignees (ADMIN uniquement, car seul l'ADMIN
  // a "assigneeMonteurId" et "assigneeCmId" dans ALLOWED_PATCH_FIELDS_BY_ROLE).
  if (typeof assigneeMonteurId === "string") {
    const monteur = await prisma.user.findUnique({
      where: { id: assigneeMonteurId },
      select: { role: true },
    });
    if (!monteur || !["MONTEUR", "ADMIN"].includes(monteur.role ?? "")) {
      return NextResponse.json({ error: "Monteur assignee invalide" }, { status: 400 });
    }
  }
  if (typeof assigneeCmId === "string") {
    const cm = await prisma.user.findUnique({
      where: { id: assigneeCmId },
      select: { role: true },
    });
    if (!cm || !["CM", "ADMIN"].includes(cm.role ?? "")) {
      return NextResponse.json({ error: "CM assignee invalide" }, { status: 400 });
    }
  }

  const updated = await prisma.publicationSlot.update({
    where: { id },
    data: {
      ...(status !== undefined ? { status: status as string } : {}),
      ...(title !== undefined ? { title: title as string | null } : {}),
      ...(caption !== undefined ? { caption: caption as string | null } : {}),
      ...(description !== undefined ? { description: description as string | null } : {}),
      ...(notes !== undefined ? { notes: notes as string | null } : {}),
      ...(templateId !== undefined ? { templateId: templateId as string | null } : {}),
      ...(scheduledAt !== undefined ? { scheduledAt: new Date(scheduledAt as string) } : {}),
      ...(fields !== undefined ? { fields: JSON.stringify(fields) } : {}),
      ...(fieldSchema !== undefined ? { fieldSchema: JSON.stringify(fieldSchema) } : {}),
      ...(assigneeMonteurId !== undefined ? { assigneeMonteurId: assigneeMonteurId as string | null } : {}),
      ...(assigneeCmId !== undefined ? { assigneeCmId: assigneeCmId as string | null } : {}),
      ...(patternId !== undefined ? { patternId: patternId as string | null } : {}),
      ...(currentVersionId !== undefined ? { currentVersionId: currentVersionId as string | null } : {}),
      ...(isAuto !== undefined ? { isAuto: isAuto as boolean } : {}),
    },
    include: {
      account: { select: { id: true, name: true, handle: true } },
      template: { select: { id: true, name: true } },
      render: { select: { id: true, status: true, pngUrl: true, videoUrl: true } },
    },
  });

  // Log d'activité — STATUS_CHANGED si le statut a changé.
  if (status !== undefined && typeof status === "string" && status !== slot.status) {
    await logActivity(prisma, {
      slotId: id,
      actorId: userId,
      type: "STATUS_CHANGED",
      payload: { from: slot.status, to: status },
    });
  }

  // Log d'activité — ASSIGNEE_CHANGED si l'un des assignees a changé.
  const monteurChanged =
    assigneeMonteurId !== undefined && assigneeMonteurId !== slot.assigneeMonteurId;
  const cmChanged =
    assigneeCmId !== undefined && assigneeCmId !== slot.assigneeCmId;
  if (monteurChanged || cmChanged) {
    await logActivity(prisma, {
      slotId: id,
      actorId: userId,
      type: "ASSIGNEE_CHANGED",
      payload: {
        ...(monteurChanged
          ? { monteur: { from: slot.assigneeMonteurId, to: assigneeMonteurId ?? null } }
          : {}),
        ...(cmChanged
          ? { cm: { from: slot.assigneeCmId, to: assigneeCmId ?? null } }
          : {}),
      },
    });
  }

  return NextResponse.json({
    ...updated,
    fields: safeJSON<Record<string, string>>(updated.fields, {}),
    fieldSchema: safeJSON<string[]>(updated.fieldSchema, []),
  });
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
