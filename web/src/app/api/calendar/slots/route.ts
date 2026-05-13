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

/** Safely parse a JSON string. Returns `fallback` if the string is falsy or invalid. */
function safeJSON<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || adminOnly(session.user.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
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

  return NextResponse.json({
    slots: slots.map((s) => ({
      ...s,
      fields: safeJSON<Record<string, string>>(s.fields, {}),
      fieldSchema: safeJSON<string[]>(s.fieldSchema, []),
    })),
    hasMore: slots.length === 500,
  });
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

  const parsedScheduledAt = new Date(scheduledAt);
  if (isNaN(parsedScheduledAt.getTime())) {
    return NextResponse.json({ error: "scheduledAt invalide" }, { status: 400 });
  }

  const slot = await prisma.publicationSlot.create({
    data: {
      accountId,
      scheduledAt: parsedScheduledAt,
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
    fields: safeJSON<Record<string, string>>(slot.fields, {}),
    fieldSchema: safeJSON<string[]>(slot.fieldSchema, []),
  });
}
