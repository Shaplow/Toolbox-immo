/**
 * GET  /api/calendar/slots — liste les slots avec filtres
 * POST /api/calendar/slots — création manuelle d'un slot (admin uniquement)
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function adminOnly(role?: string) {
  return role !== "ADMIN";
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("accountId") ?? undefined;
  const status = searchParams.get("status") ?? undefined;
  const contentType = searchParams.get("contentType") ?? undefined;
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");

  const slots = await prisma.publicationSlot.findMany({
    where: {
      ...(accountId ? { accountId } : {}),
      ...(status ? { status } : {}),
      ...(contentType ? { contentType } : {}),
      ...(dateFrom || dateTo
        ? {
            scheduledAt: {
              ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
              ...(dateTo ? { lte: new Date(dateTo) } : {}),
            },
          }
        : {}),
    },
    orderBy: { scheduledAt: "asc" },
    take: 500,
    include: {
      account: { select: { id: true, name: true, handle: true, offre: true } },
      template: { select: { id: true, name: true } },
      render: { select: { id: true, status: true, pngUrl: true, videoUrl: true } },
    },
  });

  return NextResponse.json(
    slots.map((s) => ({
      ...s,
      fields: JSON.parse(s.fields),
      fieldSchema: JSON.parse(s.fieldSchema),
    }))
  );
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || adminOnly(session.user.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const body = await req.json();
  const { accountId, scheduledAt, contentType, title, caption, notes, templateId, fields, fieldSchema } = body;

  if (!accountId || !scheduledAt || !contentType) {
    return NextResponse.json(
      { error: "accountId, scheduledAt et contentType sont requis" },
      { status: 400 }
    );
  }

  const account = await prisma.instagramAccount.findUnique({ where: { id: accountId } });
  if (!account) {
    return NextResponse.json({ error: "Compte introuvable" }, { status: 404 });
  }

  const slot = await prisma.publicationSlot.create({
    data: {
      accountId,
      scheduledAt: new Date(scheduledAt),
      contentType,
      title: title ?? null,
      caption: caption ?? null,
      notes: notes ?? null,
      templateId: templateId ?? null,
      fields: fields ? JSON.stringify(fields) : "{}",
      fieldSchema: fieldSchema ? JSON.stringify(fieldSchema) : "[]",
      isAuto: false,
    },
    include: {
      account: { select: { id: true, name: true, handle: true, offre: true } },
    },
  });

  return NextResponse.json({
    ...slot,
    fields: JSON.parse(slot.fields),
    fieldSchema: JSON.parse(slot.fieldSchema),
  });
}
