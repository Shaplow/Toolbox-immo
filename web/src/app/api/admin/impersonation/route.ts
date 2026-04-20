import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { IMPERSONATION_COOKIE_NAME } from "@/lib/userContext";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { userId } = await req.json() as { userId?: string };
  if (!userId) {
    return NextResponse.json({ error: "userId requis" }, { status: 400 });
  }

  if (userId === session.user.id) {
    return NextResponse.json({ error: "Impossible de vous impersoner vous-même" }, { status: 400 });
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, name: true, email: true },
  });

  if (!targetUser) {
    return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });
  }

  if (targetUser.role === "ADMIN") {
    return NextResponse.json({ error: "L'impersonation d'un admin n'est pas autorisée" }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true, user: targetUser });
  response.cookies.set(IMPERSONATION_COOKIE_NAME, targetUser.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  return response;
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(IMPERSONATION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}