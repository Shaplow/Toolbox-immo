import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import { assertAssigneeRole } from "@/lib/services/slot/slotService";

// PATCH /api/admin/accounts/[id] — met à jour un compte Instagram
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  const { id } = await params;
  const body = (await req.json()) as {
    name?: string;
    handle?: string;
    clientId?: string | null;
    defaultAssigneeVideasteId?: string | null;
    defaultAssigneeMonteurId?: string | null;
    defaultAssigneeCmId?: string | null;
  };
  const { name, handle, clientId } = body;

  const data: {
    name?: string;
    handle?: string;
    clientId?: string | null;
    defaultAssigneeVideasteId?: string | null;
    defaultAssigneeMonteurId?: string | null;
    defaultAssigneeCmId?: string | null;
  } = {};
  if (name?.trim()) data.name = name.trim();
  if (handle?.trim()) data.handle = handle.trim().replace(/^@/, "");
  if ("clientId" in body) {
    if (clientId === null) {
      data.clientId = null;
    } else if (typeof clientId === "string" && clientId.trim()) {
      data.clientId = clientId.trim();
    }
  }

  // Équipe par défaut du compte — héritée par les recettes et les fiches.
  // Rôles vérifiés ici : une assignation ne doit pas pouvoir désigner
  // quelqu'un qui n'a pas le rôle (mêmes règles que les slots).
  const assigneeFields = [
    ["defaultAssigneeVideasteId", ["VIDEASTE", "ADMIN"], "Vidéaste"],
    ["defaultAssigneeMonteurId", ["MONTEUR", "ADMIN"], "Monteur"],
    ["defaultAssigneeCmId", ["CM", "ADMIN"], "CM"],
  ] as const;
  for (const [field, roles, label] of assigneeFields) {
    if (!(field in body)) continue;
    const value = body[field];
    if (value === null || value === "") {
      data[field] = null;
      continue;
    }
    if (typeof value !== "string") continue;
    try {
      await assertAssigneeRole(value, [...roles], label);
    } catch {
      return NextResponse.json({ error: `${label} invalide` }, { status: 400 });
    }
    data[field] = value;
  }

  try {
    const account = await prisma.instagramAccount.update({ where: { id }, data });
    return NextResponse.json(account);
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2025") {
      return NextResponse.json({ error: "Compte introuvable" }, { status: 404 });
    }
    console.error("[admin/accounts/[id]] PATCH error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

// DELETE /api/admin/accounts/[id] — supprime un compte Instagram
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  const { id } = await params;
  try {
    await prisma.instagramAccount.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2025") {
      return NextResponse.json({ error: "Compte introuvable" }, { status: 404 });
    }
    console.error("[admin/accounts/[id]] DELETE error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
