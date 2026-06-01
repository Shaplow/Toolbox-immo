import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { EXTERNAL_GENERATOR_ALLOWED_TOOLS, type Tool } from "@/lib/permissions";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/admin/users/[id] — modifier nom, mot de passe, rôle
export async function PATCH(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const { name, username, email, password, role, permissions } = body;

  const VALID_ROLES = ["EXTERNAL_GENERATOR", "ADMIN", "VIDEASTE", "MONTEUR", "CM"];

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
    const nextPerms: Tool[] = Array.isArray(permissions)
      ? (permissions as Tool[])
      : (() => {
          try { return JSON.parse(permissions as string) as Tool[]; }
          catch { return []; }
        })();

    // D4 étape 1 — Si le user (existant ou après update) sera USER, valider
    // qu'on n'AJOUTE pas de perms non-autorisées. Les perms héritées peuvent
    // être retirées librement, mais pas étendues.
    const existing = await prisma.user.findUnique({
      where: { id },
      select: { role: true, permissions: true },
    });
    const futureRole = (role as string | undefined) ?? existing?.role ?? "EXTERNAL_GENERATOR";

    if (futureRole === "EXTERNAL_GENERATOR") {
      // Security-auditor MED5 (2026-06-01) : vérifier TOUTES les perms finales,
      // pas seulement les ajoutées. Sinon : ADMIN bascule user role=MONTEUR
      // (sans contrainte) + ajoute "captions/transcription/description" puis
      // re-bascule role=EXTERNAL_GENERATOR — `added` est vide (perms étaient
      // déjà là), garde passée, EXTERNAL_GENERATOR retient des outils interdits.
      const allowed = new Set<Tool>(EXTERNAL_GENERATOR_ALLOWED_TOOLS);
      const forbiddenFinal = nextPerms.filter((p) => !allowed.has(p));
      if (forbiddenFinal.length > 0) {
        return NextResponse.json(
          {
            error: `Le rôle Client externe ne peut conserver que : ${EXTERNAL_GENERATOR_ALLOWED_TOOLS.join(", ")}. Outils interdits détectés : ${forbiddenFinal.join(", ")}.`,
          },
          { status: 400 },
        );
      }
    }

    data.permissions = JSON.stringify(nextPerms);
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
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;
  if (id === userContext.actualUser.id) {
    return NextResponse.json({ error: "Impossible de supprimer votre propre compte" }, { status: 400 });
  }

  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
