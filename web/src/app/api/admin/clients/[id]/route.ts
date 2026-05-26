import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

// GET /api/admin/clients/[id] — récupère un client avec ses comptes
export async function GET(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;
  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      accounts: {
        select: { id: true, name: true, handle: true },
        orderBy: { name: "asc" },
      },
    },
  });

  if (!client) {
    return NextResponse.json({ error: "Client introuvable" }, { status: 404 });
  }

  return NextResponse.json(client);
}

// PATCH /api/admin/clients/[id] — modifier un client
export async function PATCH(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json() as { name?: string; contactName?: string; email?: string; phone?: string };
  const { name, contactName, email, phone } = body;

  const data: { name?: string; contactName?: string | null; email?: string | null; phone?: string | null } = {};
  if (name?.trim()) data.name = name.trim();
  if ("contactName" in body) data.contactName = contactName?.trim() || null;
  if ("email" in body) data.email = email?.trim() || null;
  if ("phone" in body) data.phone = phone?.trim() || null;

  try {
    const client = await prisma.client.update({
      where: { id },
      data,
      include: {
        accounts: {
          select: { id: true, name: true, handle: true },
          orderBy: { name: "asc" },
        },
      },
    });
    return NextResponse.json(client);
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2025") {
      return NextResponse.json({ error: "Client introuvable" }, { status: 404 });
    }
    console.error("[admin/clients/[id]] PATCH error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

// DELETE /api/admin/clients/[id] — supprimer un client (accounts.clientId → SetNull via schema)
export async function DELETE(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;
  try {
    await prisma.client.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2025") {
      return NextResponse.json({ error: "Client introuvable" }, { status: 404 });
    }
    console.error("[admin/clients/[id]] DELETE error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
