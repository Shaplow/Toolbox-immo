import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

// GET /api/admin/clients — liste tous les clients
export async function GET() {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const clients = await prisma.client.findMany({
    orderBy: { name: "asc" },
    include: {
      accounts: {
        select: { id: true, name: true, handle: true },
        orderBy: { name: "asc" },
      },
    },
  });

  return NextResponse.json(clients);
}

// POST /api/admin/clients — créer un nouveau client
export async function POST(req: NextRequest) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const body = await req.json() as { name?: string; contactName?: string; email?: string; phone?: string };
  const { name, contactName, email, phone } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "Le nom est requis" }, { status: 400 });
  }

  const client = await prisma.client.create({
    data: {
      name: name.trim(),
      contactName: contactName?.trim() || null,
      email: email?.trim() || null,
      phone: phone?.trim() || null,
    },
    include: {
      accounts: {
        select: { id: true, name: true, handle: true },
      },
    },
  });

  return NextResponse.json(client, { status: 201 });
}
