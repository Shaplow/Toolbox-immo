import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

function adminOnly(role?: string) {
  return role !== "ADMIN";
}

// GET /api/admin/users
export async function GET() {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      username: true,
      email: true,
      name: true,
      role: true,
      permissions: true,
      createdAt: true,
      accesses: {
        select: {
          templateId: true,
          template: { select: { id: true, name: true, client: true } },
        },
      },
    },
  });

  return NextResponse.json(users);
}

// POST /api/admin/users — créer un utilisateur
export async function POST(req: NextRequest) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { username, name, email, password, role = "USER" } = await req.json();
  if (!username || !name || !password) {
    return NextResponse.json({ error: "username, name et password requis" }, { status: 400 });
  }

  const existingUsername = await prisma.user.findUnique({ where: { username } });
  if (existingUsername) {
    return NextResponse.json({ error: "Cet identifiant est déjà utilisé" }, { status: 409 });
  }
  if (email) {
    const existingEmail = await prisma.user.findUnique({ where: { email } });
    if (existingEmail) {
      return NextResponse.json({ error: "Cet email est déjà utilisé" }, { status: 409 });
    }
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { username, name, email: email || null, passwordHash, role },
    select: { id: true, username: true, name: true, email: true, role: true, createdAt: true },
  });

  return NextResponse.json(user, { status: 201 });
}
