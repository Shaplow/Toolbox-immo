/**
 * POST   /api/admin/view-as { role: "VIDEASTE"|"MONTEUR"|"CM" } — set view-as cookie
 * DELETE /api/admin/view-as — unset (retour vue admin)
 *
 * Permet à un ADMIN de basculer sur l'interface d'un autre rôle en gardant
 * son propre id (donc voit ses propres slots assignés). Distinct de
 * l'impersonation qui change complètement l'id user.
 *
 * Auth() direct pour éviter la dépendance circulaire (getUserContext lit
 * le cookie qu'on est en train de set/clear).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { VIEW_AS_ROLE_COOKIE_NAME } from "@/lib/userContext";

const VALID_ROLES = ["VIDEASTE", "MONTEUR", "CM"] as const;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { role } = (await req.json()) as { role?: string };
  if (!role || !VALID_ROLES.includes(role as (typeof VALID_ROLES)[number])) {
    return NextResponse.json(
      { error: `role doit être l'un de : ${VALID_ROLES.join(", ")}` },
      { status: 400 },
    );
  }

  console.info("[view-as] start", {
    actorId: session.user.id,
    role,
    timestamp: new Date().toISOString(),
  });

  const response = NextResponse.json({ ok: true, role });
  // maxAge obligatoire : sans expiration, le cookie devient un cookie de session
  // navigateur qui survit aux restaurations d'onglets (Chrome/Firefox session
  // restore) — un admin qui ferme son onglet "view-as MONTEUR" puis rouvre
  // sa session se retrouve silencieusement bridé à canAdminBypass=false sur
  // les routes admin. Même fix que celui appliqué côté impersonation.
  response.cookies.set(VIEW_AS_ROLE_COOKIE_NAME, role, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 8 * 60 * 60, // 8h — aligné sur l'impersonation
  });
  return response;
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  console.info("[view-as] stop", {
    actorId: session.user.id,
    timestamp: new Date().toISOString(),
  });

  const response = NextResponse.json({ ok: true });
  response.cookies.set(VIEW_AS_ROLE_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
