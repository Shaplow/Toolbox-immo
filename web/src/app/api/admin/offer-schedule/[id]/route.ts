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
  const { offre, dayOfWeek, publishTime, templateId, isActive } = body;

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
  if (publishTime !== undefined) {
    const [phh, pmm] = publishTime.split(":").map(Number);
    if (phh! > 23 || pmm! > 59) {
      return NextResponse.json({ error: "publishTime invalide (heures 0–23, minutes 0–59)" }, { status: 400 });
    }
  }

  // If templateId is being updated, derive contentType from the new template
  let resolvedContentType: string | undefined;
  if (templateId !== undefined) {
    const tmpl = await prisma.template.findUnique({ where: { id: templateId }, select: { contentType: true } });
    if (!tmpl) return NextResponse.json({ error: "Template introuvable" }, { status: 400 });
    if (!tmpl.contentType) return NextResponse.json({ error: "Ce template n'a pas de type de contenu défini" }, { status: 400 });
    resolvedContentType = tmpl.contentType;
  }

  const updated = await prisma.offerScheduleRule.update({
    where: { id },
    data: {
      ...(offre !== undefined ? { offre } : {}),
      ...(dayOfWeek !== undefined ? { dayOfWeek } : {}),
      ...(publishTime !== undefined ? { publishTime } : {}),
      ...(resolvedContentType !== undefined ? { contentType: resolvedContentType } : {}),
      ...(templateId !== undefined ? { templateId } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
    },
    include: { template: { select: { id: true, name: true, contentType: true } } },
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
