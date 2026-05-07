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
  });

  return NextResponse.json(rules);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || adminOnly(session.user.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const body = await req.json();
  const { offre, dayOfWeek, publishTime, contentType, isActive } = body;

  if (!offre || dayOfWeek === undefined || !publishTime || !contentType) {
    return NextResponse.json(
      { error: "offre, dayOfWeek, publishTime et contentType sont requis" },
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

  const rule = await prisma.offerScheduleRule.create({
    data: {
      offre,
      dayOfWeek,
      publishTime,
      contentType,
      isActive: isActive ?? true,
    },
  });

  return NextResponse.json(rule, { status: 201 });
}
