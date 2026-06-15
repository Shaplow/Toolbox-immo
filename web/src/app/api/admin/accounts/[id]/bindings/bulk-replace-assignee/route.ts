/**
 * POST /api/admin/accounts/[id]/bindings/bulk-replace-assignee
 *
 * Sprint C — Remplace l'assignée par défaut sur tous les bindings du compte
 * où elle est actuellement positionnée à la valeur `from`.
 *
 * Body : { role: "monteur" | "cm" | "videaste", from: string | null, to: string | null }
 *
 * Cas d'usage : monteur quitte l'équipe → remplacer son ID par celui du
 * remplaçant en 1 click sur tous les bindings du compte.
 *
 * Admin only.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

interface Params {
  params: Promise<{ id: string }>;
}

type Role = "monteur" | "cm" | "videaste";
const VALID_ROLES: Role[] = ["monteur", "cm", "videaste"];

export async function POST(req: NextRequest, { params }: Params) {
  const ctx = await getUserContext();
  if (!ctx?.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }
  const { id: accountId } = await params;

  let body: { role?: Role; from?: string | null; to?: string | null };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  if (!body.role || !VALID_ROLES.includes(body.role)) {
    return NextResponse.json(
      { error: `role doit être un de ${VALID_ROLES.join(", ")}` },
      { status: 400 },
    );
  }
  if (body.from === undefined) {
    return NextResponse.json(
      { error: "from requis (peut être null pour cibler les bindings non assignés)" },
      { status: 400 },
    );
  }
  if (body.to === undefined) {
    return NextResponse.json(
      { error: "to requis (peut être null pour désassigner)" },
      { status: 400 },
    );
  }
  if (body.from === body.to) {
    return NextResponse.json(
      { error: "from et to sont identiques — rien à remplacer" },
      { status: 400 },
    );
  }

  const account = await prisma.instagramAccount.findUnique({
    where: { id: accountId },
    select: { id: true },
  });
  if (!account) {
    return NextResponse.json({ error: "Compte introuvable" }, { status: 404 });
  }

  // Vérifie l'existence + le rôle du nouvel assigné si fourni.
  if (body.to) {
    const user = await prisma.user.findUnique({
      where: { id: body.to },
      select: { role: true },
    });
    if (!user) {
      return NextResponse.json({ error: "Utilisateur cible introuvable" }, { status: 404 });
    }
    const expectedRoles =
      body.role === "monteur"
        ? ["MONTEUR", "ADMIN"]
        : body.role === "cm"
          ? ["CM", "ADMIN"]
          : ["VIDEASTE", "ADMIN"];
    if (!expectedRoles.includes(user.role)) {
      return NextResponse.json(
        { error: `Utilisateur cible doit être ${body.role}` },
        { status: 400 },
      );
    }
  }

  const field =
    body.role === "monteur"
      ? "defaultAssigneeMonteurId"
      : body.role === "cm"
        ? "defaultAssigneeCmId"
        : "defaultAssigneeVideasteId";

  // Bug C.2 — Avant : updateMany hors transaction et aucune trace d'audit.
  // Désormais : (1) charge les bindings concernés dans une transaction,
  // (2) updateMany, (3) log structuré (PatternBinding n'a pas son propre
  // modèle d'activité — PublicationActivity exige un slotId).
  const { updatedCount, bindingIds } = await prisma.$transaction(async (tx) => {
    const affected = await tx.patternBinding.findMany({
      where: { accountId, [field]: body.from },
      select: { id: true },
    });
    const ids = affected.map((b) => b.id);
    if (ids.length === 0) {
      return { updatedCount: 0, bindingIds: ids };
    }
    const upd = await tx.patternBinding.updateMany({
      where: { id: { in: ids } },
      data: { [field]: body.to },
    });
    return { updatedCount: upd.count, bindingIds: ids };
  });

  if (updatedCount > 0) {
    console.info("[audit] bulk-replace-assignee", {
      accountId,
      actorId: ctx.actualUser.id,
      role: body.role,
      from: body.from,
      to: body.to,
      bindingIds,
    });
  }

  return NextResponse.json(
    { updatedCount, bindingIds },
    { status: 200 },
  );
}
