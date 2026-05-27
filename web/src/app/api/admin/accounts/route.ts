import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

// GET /api/admin/accounts — liste les comptes Instagram
// Accepte ?clientId=<id> pour filtrer par client
export async function GET(req: NextRequest) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const clientIdFilter = searchParams.get("clientId");

  try {
    const accounts = await prisma.instagramAccount.findMany({
      where: clientIdFilter ? { clientId: clientIdFilter } : undefined,
      orderBy: { name: "asc" },
      include: {
        _count: { select: { renders: true } },
        cursors: {
          include: { library: { select: { id: true, name: true, setSequence: true } } },
        },
        client: { select: { id: true, name: true } },
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
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const body = await req.json() as { name?: string; handle?: string; clientId?: string | null };
  const { name, handle, clientId } = body;

  if (!name?.trim()) return NextResponse.json({ error: "Le nom est requis" }, { status: 400 });
  if (!handle?.trim()) return NextResponse.json({ error: "Le handle Instagram est requis" }, { status: 400 });
  // Vérifier que le client existe si clientId est fourni
  if (clientId) {
    const existingClient = await prisma.client.findUnique({ where: { id: clientId } });
    if (!existingClient) {
      return NextResponse.json({ error: "Client introuvable" }, { status: 400 });
    }
  }

  try {
    const account = await prisma.instagramAccount.create({
      data: {
        name: name.trim(),
        handle: handle.trim().replace(/^@/, ""),
        ...(clientId ? { client: { connect: { id: clientId } } } : {}),
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
