import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

// GET /api/admin/libraries/data — liste les DataLibrary (+ campaign count)
export async function GET() {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  try {
    const libraries = await prisma.dataLibrary.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { campaigns: true } } },
    });
    return NextResponse.json(libraries);
  } catch (err) {
    console.error("[admin/libraries/data] GET error:", err);
    return NextResponse.json({ error: "Erreur serveur lors du chargement" }, { status: 500 });
  }
}

// POST /api/admin/libraries/data — crée une DataLibrary
export async function POST(req: NextRequest) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const body = await req.json() as { name?: string; templateType?: string; description?: string };
  const { name, templateType, description } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "Le nom est requis" }, { status: 400 });
  }
  if (!templateType?.trim()) {
    return NextResponse.json({ error: "Le templateType est requis (ex: RPI, RTIPS)" }, { status: 400 });
  }

  try {
    const library = await prisma.dataLibrary.create({
      data: {
        name: name.trim(),
        templateType: templateType.trim().toUpperCase(),
        description: description?.trim() ?? null,
      },
    });
    return NextResponse.json(library, { status: 201 });
  } catch (err) {
    console.error("[admin/libraries/data] POST error:", err);
    return NextResponse.json({ error: "Erreur serveur lors de la création" }, { status: 500 });
  }
}
