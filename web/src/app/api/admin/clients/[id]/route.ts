import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import { clientPatchSchema, validateBody } from "@/lib/validation/apiSchemas";

type Params = { params: Promise<{ id: string }> };

// GET /api/admin/clients/[id] — récupère un client avec ses comptes
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

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
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  const { id } = await params;

  // E5 — validation via Zod schema (clientPatchSchema). Le schema applique
  // .strict() (rejette les clés inconnues) et z.string().email() pour valider
  // le format de l'email.
  const parsed = await validateBody(req, clientPatchSchema);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const body = parsed.data;

  const data: { name?: string; contactName?: string | null; email?: string | null; phone?: string | null } = {};
  if (body.name) data.name = body.name;
  if ("contactName" in body) data.contactName = body.contactName?.trim() || null;
  if ("email" in body) data.email = body.email?.trim() || null;
  if ("phone" in body) data.phone = body.phone?.trim() || null;

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
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

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
