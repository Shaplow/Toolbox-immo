import { NextRequest, NextResponse } from "next/server";
// NOTE: this route intentionally keeps auth() direct instead of getUserContext().
// getUserContext() reads the impersonation cookie to resolve the effective user,
// so using it here to start/stop impersonation would create a circular dependency
// (it would read the cookie being set/cleared in this very response).
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { IMPERSONATION_COOKIE_NAME, VIEW_AS_ROLE_COOKIE_NAME } from "@/lib/userContext";

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

  // Audit log — Phase 1.9 B4
  console.info("[impersonation] start", {
    actorId: session.user.id,
    actorEmail: session.user.email,
    targetUserId: targetUser.id,
    targetUserEmail: targetUser.email,
    targetUserRole: targetUser.role,
    timestamp: new Date().toISOString(),
  });

  const response = NextResponse.json({ ok: true, user: targetUser });
  response.cookies.set(IMPERSONATION_COOKIE_NAME, targetUser.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    // 8h — couvre une journée de travail mais expire pendant la nuit. Sans
    // maxAge le cookie était session-only mais survivait à la restauration
    // de session de Chrome/Firefox, exposant l'admin à reprendre l'identité
    // impersonnée sans le savoir.
    maxAge: 8 * 60 * 60,
  });
  // Phase 6.1 — clear le cookie view-as si présent. Sinon : après un stop
  // d'impersonation, l'admin se retrouvait silencieusement en mode view-as
  // d'un rôle qu'il avait choisi avant l'impersonation, sans l'avoir voulu.
  response.cookies.set(VIEW_AS_ROLE_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  // Audit log — Phase 1.9 B4
  console.info("[impersonation] stop", {
    actorId: session.user.id,
    actorEmail: session.user.email,
    timestamp: new Date().toISOString(),
  });

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