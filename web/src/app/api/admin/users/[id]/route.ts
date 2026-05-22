import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/admin/users/[id] — modifier nom, mot de passe, rôle
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const { name, username, email, password, role, permissions } = body;

  const VALID_ROLES = ["USER", "ADMIN", "MONTEUR", "CM"];

  const data: Record<string, unknown> = {};
  if (name) data.name = name;
  if (username) data.username = username;
  if (email !== undefined) data.email = email || null;
  if (role) {
    if (!VALID_ROLES.includes(role as string)) {
      return NextResponse.json({ error: `Rôle invalide. Valeurs acceptées : ${VALID_ROLES.join(", ")}` }, { status: 400 });
    }
    data.role = role;
  }
  if (password) data.passwordHash = await bcrypt.hash(password, 12);
  // permissions est un tableau JSON sérialisé en string ou directement un array
  if (permissions !== undefined) {
    data.permissions = Array.isArray(permissions)
      ? JSON.stringify(permissions)
      : permissions;
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, name: true, email: true, role: true, permissions: true },
  });

  return NextResponse.json(user);
}

// DELETE /api/admin/users/[id]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;
  if (id === session.user.id) {
    return NextResponse.json({ error: "Impossible de supprimer votre propre compte" }, { status: 400 });
  }

  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
