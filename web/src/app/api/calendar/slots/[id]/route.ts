/**
 * PATCH  /api/calendar/slots/[id] — mise à jour d'un slot
 * DELETE /api/calendar/slots/[id] — suppression d'un slot (admin uniquement)
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

const VALID_STATUSES = ["TO_DO", "IN_PROGRESS", "READY", "CHECKING", "DONE"];

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();

  const slot = await prisma.publicationSlot.findUnique({ where: { id } });
  if (!slot) {
    return NextResponse.json({ error: "Slot introuvable" }, { status: 404 });
  }

  const { status, title, caption, notes, templateId, scheduledAt, contentType, fields, fieldSchema } = body;

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `Statut invalide. Valeurs acceptées : ${VALID_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  const updated = await prisma.publicationSlot.update({
    where: { id },
    data: {
      ...(status !== undefined ? { status } : {}),
      ...(title !== undefined ? { title } : {}),
      ...(caption !== undefined ? { caption } : {}),
      ...(notes !== undefined ? { notes } : {}),
      ...(templateId !== undefined ? { templateId } : {}),
      ...(scheduledAt !== undefined ? { scheduledAt: new Date(scheduledAt) } : {}),
      ...(contentType !== undefined ? { contentType } : {}),
      ...(fields !== undefined ? { fields: JSON.stringify(fields) } : {}),
      ...(fieldSchema !== undefined ? { fieldSchema: JSON.stringify(fieldSchema) } : {}),
    },
    include: {
      account: { select: { id: true, name: true, handle: true, offre: true } },
      template: { select: { id: true, name: true } },
      render: { select: { id: true, status: true, pngUrl: true, videoUrl: true } },
    },
  });

  return NextResponse.json({
    ...updated,
    fields: JSON.parse(updated.fields),
    fieldSchema: JSON.parse(updated.fieldSchema),
  });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;

  const slot = await prisma.publicationSlot.findUnique({ where: { id } });
  if (!slot) {
    return NextResponse.json({ error: "Slot introuvable" }, { status: 404 });
  }

  await prisma.publicationSlot.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
