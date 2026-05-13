import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function adminOnly(role?: string) {
  return role !== "ADMIN";
}

// GET /api/admin/accounts — liste les comptes Instagram
export async function GET() {
  const session = await auth();
  if (!session?.user?.id || adminOnly(session.user.role)) {
    return NextResponse.json([]);
  }

  try {
    const accounts = await prisma.instagramAccount.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: { select: { renders: true } },
        cursors: {
          include: { library: { select: { id: true, name: true, setSequence: true } } },
        },
      },
    });
    return NextResponse.json(accounts);
  } catch (err) {
    console.error("[admin/accounts] GET error:", err);
    return NextResponse.json({ error: "Erreur serveur lors du chargement" }, { status: 500 });
  }
}

// POST /api/admin/accounts — crée un compte Instagram
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || adminOnly(session.user.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const body = await req.json() as { name?: string; handle?: string; offre?: string };
  const { name, handle, offre } = body;

  if (!name?.trim()) return NextResponse.json({ error: "Le nom est requis" }, { status: 400 });
  if (!handle?.trim()) return NextResponse.json({ error: "Le handle Instagram est requis" }, { status: 400 });
  if (!offre?.trim()) {
    return NextResponse.json({ error: "L'offre est requise" }, { status: 400 });
  }
  const existingOffer = await prisma.offer.findUnique({ where: { name: offre } });
  if (!existingOffer) {
    return NextResponse.json({ error: `Offre inconnue : ${offre}` }, { status: 400 });
  }

  try {
    const account = await prisma.instagramAccount.create({
      data: {
        name: name.trim(),
        handle: handle.trim().replace(/^@/, ""),
        offre,
      },
    });
    return NextResponse.json(account, { status: 201 });
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
      return NextResponse.json({ error: "Ce handle Instagram est déjà utilisé" }, { status: 409 });
    }
    console.error("[admin/accounts] POST error:", err);
    return NextResponse.json({ error: "Erreur serveur lors de la création" }, { status: 500 });
  }
}
