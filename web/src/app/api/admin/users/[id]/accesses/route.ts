import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

// GET /api/admin/users/[id]/accesses
export async function GET(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;
  const accesses = await prisma.templateAccess.findMany({
    where: { userId: id },
    include: { template: { select: { id: true, name: true, client: true } } },
  });

  return NextResponse.json(accesses);
}

// POST /api/admin/users/[id]/accesses — assigner un template
export async function POST(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;
  const { templateId } = await req.json();
  if (!templateId) return NextResponse.json({ error: "templateId requis" }, { status: 400 });

  const access = await prisma.templateAccess.upsert({
    where: { userId_templateId: { userId: id, templateId } },
    create: { userId: id, templateId },
    update: {},
    include: { template: { select: { id: true, name: true, client: true } } },
  });

  return NextResponse.json(access, { status: 201 });
}

// DELETE /api/admin/users/[id]/accesses — révoquer tous ou un template
export async function DELETE(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;
  const { templateId } = await req.json().catch(() => ({}));

  if (templateId) {
    await prisma.templateAccess.deleteMany({ where: { userId: id, templateId } });
  } else {
    await prisma.templateAccess.deleteMany({ where: { userId: id } });
  }

  return NextResponse.json({ success: true });
}
