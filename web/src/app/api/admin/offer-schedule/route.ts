/**
 * GET  /api/admin/offer-schedule — liste toutes les règles
 * POST /api/admin/offer-schedule — créer une règle (admin uniquement)
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function adminOnly(role?: string) {
  return role !== "ADMIN";
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || adminOnly(session.user.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const rules = await prisma.offerScheduleRule.findMany({
    orderBy: [{ offre: "asc" }, { dayOfWeek: "asc" }, { publishTime: "asc" }],
    include: { template: { select: { id: true, name: true, contentType: true } } },
  });

  return NextResponse.json(rules);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || adminOnly(session.user.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const body = await req.json();
  const { offre, dayOfWeek, publishTime, templateId, isActive } = body;

  if (!offre || dayOfWeek === undefined || !publishTime || !templateId) {
    return NextResponse.json(
      { error: "offre, dayOfWeek, publishTime et templateId sont requis" },
      { status: 400 }
    );
  }

  if (dayOfWeek < 1 || dayOfWeek > 7) {
    return NextResponse.json({ error: "dayOfWeek doit être entre 1 (Lundi) et 7 (Dimanche)" }, { status: 400 });
  }

  // Vérification format HH:MM
  if (!/^\d{2}:\d{2}$/.test(publishTime)) {
    return NextResponse.json({ error: "publishTime doit être au format HH:MM" }, { status: 400 });
  }
  const [phh, pmm] = publishTime.split(":").map(Number);
  if (phh! > 23 || pmm! > 59) {
    return NextResponse.json({ error: "publishTime invalide (heures 0–23, minutes 0–59)" }, { status: 400 });
  }

  const template = await prisma.template.findUnique({ where: { id: templateId }, select: { contentType: true } });
  if (!template) {
    return NextResponse.json({ error: "Template introuvable" }, { status: 400 });
  }
  if (!template.contentType) {
    return NextResponse.json({ error: "Ce template n'a pas de type de contenu défini" }, { status: 400 });
  }

  const rule = await prisma.offerScheduleRule.create({
    data: {
      offre,
      dayOfWeek,
      publishTime,
      contentType: template.contentType,
      templateId,
      isActive: isActive ?? true,
    },
    include: { template: { select: { id: true, name: true, contentType: true } } },
  });

  return NextResponse.json(rule, { status: 201 });
}
