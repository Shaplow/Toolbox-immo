/**
 * PATCH  /api/admin/offer-schedule/[id] — modifier une règle
 * DELETE /api/admin/offer-schedule/[id] — supprimer une règle
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

function adminOnly(role?: string) {
  return role !== "ADMIN";
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id || adminOnly(session.user.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const { offre, dayOfWeek, publishTime, contentType, isActive } = body;

  const rule = await prisma.offerScheduleRule.findUnique({ where: { id } });
  if (!rule) {
    return NextResponse.json({ error: "Règle introuvable" }, { status: 404 });
  }

  if (dayOfWeek !== undefined && (dayOfWeek < 1 || dayOfWeek > 7)) {
    return NextResponse.json({ error: "dayOfWeek doit être entre 1 (Lundi) et 7 (Dimanche)" }, { status: 400 });
  }

  if (publishTime !== undefined && !/^\d{2}:\d{2}$/.test(publishTime)) {
    return NextResponse.json({ error: "publishTime doit être au format HH:MM" }, { status: 400 });
  }

  const updated = await prisma.offerScheduleRule.update({
    where: { id },
    data: {
      ...(offre !== undefined ? { offre } : {}),
      ...(dayOfWeek !== undefined ? { dayOfWeek } : {}),
      ...(publishTime !== undefined ? { publishTime } : {}),
      ...(contentType !== undefined ? { contentType } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id || adminOnly(session.user.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;

  const rule = await prisma.offerScheduleRule.findUnique({ where: { id } });
  if (!rule) {
    return NextResponse.json({ error: "Règle introuvable" }, { status: 404 });
  }

  await prisma.offerScheduleRule.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
